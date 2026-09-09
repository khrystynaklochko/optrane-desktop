import { admin } from './db.ts';
import { breakdownPdf } from './gemini.ts';
import type { SceneBreakdown, SceneElement } from './domain.ts';
import { sha256Hex, slug, stableStringify } from './util.ts';

export function normalizeScene(scene: SceneBreakdown) {
  return {
    scene_number: scene.scene_number.trim(),
    heading: scene.heading.trim().toUpperCase().replace(/\s+/g, ' '),
    location: scene.location.trim().replace(/\s+/g, ' '),
    interior_exterior: scene.interior_exterior.trim().toUpperCase(),
    day_night: scene.day_night.trim().toUpperCase(),
    page_eighths: Number(scene.page_eighths || 0),
    description: scene.description.trim().replace(/\s+/g, ' '),
    elements: [...scene.elements].map((e) => ({
      type: e.type.trim().toUpperCase(), name: e.name.trim(), quantity: Number(e.quantity || 1), confidence: e.confidence,
    })).sort((a, b) => `${a.type}:${a.name.toLowerCase()}`.localeCompare(`${b.type}:${b.name.toLowerCase()}`)),
  };
}

export async function sceneHash(scene: SceneBreakdown) {
  return await sha256Hex(stableStringify(normalizeScene(scene)));
}

export function buildDependencies(scene: SceneBreakdown, productionId: string) {
  const rows: Record<string, unknown>[] = [];
  for (const element of scene.elements) {
    const et = element.type.trim().toUpperCase();
    const targetType: Record<string, string> = {
      CAST: 'CAST_MEMBER', EXTRA: 'EXTRA', STUNT: 'STUNT_REQUIREMENT', MINOR: 'CAST_MEMBER', SPECIAL_EFFECT: 'SPECIAL_EFFECT',
      PROP: 'PROP', VEHICLE: 'VEHICLE', ANIMAL: 'ANIMAL', WARDROBE: 'WARDROBE', SPECIAL_EQUIPMENT: 'EQUIPMENT', LOCATION: 'LOCATION',
      MAKEUP: 'MAKEUP', SET_DRESSING: 'SET_DRESSING', SECURITY: 'SECURITY',
    };
    rows.push({
      production_id: productionId,
      source_type: 'SCENE', source_id: scene.scene_number, relation: 'REQUIRES',
      target_type: targetType[et] ?? et, target_id: slug(element.name),
      criticality: ['MINOR','STUNT','SPECIAL_EQUIPMENT','LOCATION'].includes(et) ? 'HIGH' : 'MEDIUM',
      state: ['MINOR','STUNT','SPECIAL_EQUIPMENT'].includes(et) ? 'VERIFY_REQUIRED' : 'CONFIRMED',
      metadata: { confidence: element.confidence, quantity: element.quantity, label: element.name },
    });
  }
  if (scene.location && !scene.elements.some((e) => e.type === 'LOCATION' && e.name.toLowerCase() === scene.location.toLowerCase())) {
    rows.push({ production_id: productionId, source_type: 'SCENE', source_id: scene.scene_number, relation: 'REQUIRES', target_type: 'LOCATION', target_id: slug(scene.location), criticality: 'HIGH', state: 'CONFIRMED', metadata: { label: scene.location } });
  }
  return rows;
}

export async function loadScenes(productionId: string, version: number): Promise<SceneBreakdown[]> {
  const { data: scenes, error } = await admin().from('scenes').select('*').eq('production_id', productionId).eq('script_version', version).order('scene_number');
  if (error) throw new Error(`load scenes: ${error.message}`);
  if (!scenes?.length) return [];
  const { data: elements, error: elementsError } = await admin().from('scene_elements').select('*').eq('production_id', productionId).eq('script_version', version);
  if (elementsError) throw new Error(`load scene elements: ${elementsError.message}`);
  const grouped = new Map<string, SceneElement[]>();
  for (const row of elements ?? []) {
    const list = grouped.get(row.scene_number) ?? [];
    list.push({ type: row.element_type, name: row.element_name, quantity: row.quantity, confidence: row.confidence, metadata: row.metadata });
    grouped.set(row.scene_number, list);
  }
  return scenes.map((row) => ({
    scene_number: row.scene_number, heading: row.heading, location: row.location, interior_exterior: row.interior_exterior,
    day_night: row.day_night, page_eighths: row.page_eighths, description: row.description, elements: grouped.get(row.scene_number) ?? [],
  }));
}

export async function persistBreakdown(productionId: string, version: number, scenes: SceneBreakdown[]) {
  await admin().from('scene_elements').delete().eq('production_id', productionId).eq('script_version', version);
  await admin().from('scenes').delete().eq('production_id', productionId).eq('script_version', version);

  for (const scene of scenes) {
    const normalized = normalizeScene(scene);
    const hash = await sceneHash(scene);
    const { data: sceneRow, error } = await admin().from('scenes').insert({
      production_id: productionId, script_version: version, scene_number: normalized.scene_number, heading: normalized.heading,
      location: normalized.location, interior_exterior: normalized.interior_exterior, day_night: normalized.day_night,
      page_eighths: normalized.page_eighths, description: normalized.description, content_hash: hash,
    }).select('id').single();
    if (error) throw new Error(`persist scene ${scene.scene_number}: ${error.message}`);
    if (normalized.elements.length) {
      const { error: elementError } = await admin().from('scene_elements').insert(normalized.elements.map((element) => ({
        scene_id: sceneRow.id, production_id: productionId, script_version: version, scene_number: normalized.scene_number,
        element_type: element.type, element_name: element.name, quantity: element.quantity, confidence: element.confidence,
      })));
      if (elementError) throw new Error(`persist elements ${scene.scene_number}: ${elementError.message}`);
    }
  }
  await admin().from('script_versions').update({ processing_status: 'READY', processing_error: null }).eq('production_id', productionId).eq('version', version);
}

export async function rebuildDependencies(productionId: string, scenes: SceneBreakdown[]) {
  await admin().from('production_dependencies').delete().eq('production_id', productionId).eq('source_type', 'SCENE');
  const deps = scenes.flatMap((scene) => buildDependencies(scene, productionId));
  if (deps.length) {
    const { error } = await admin().from('production_dependencies').insert(deps);
    if (error) throw new Error(`persist dependencies: ${error.message}`);
  }
  const locations = new Set(scenes.map((s) => s.location).filter(Boolean));
  const cast = new Set(scenes.flatMap((s) => s.elements.filter((e) => e.type === 'CAST' || e.type === 'MINOR').map((e) => e.name)));
  await admin().from('productions').update({ scenes_count: scenes.length, cast_count: cast.size, locations_count: locations.size }).eq('id', productionId);
}

export async function ensureBreakdown(productionId: string, version: number): Promise<SceneBreakdown[]> {
  const existing = await loadScenes(productionId, version);
  if (existing.length) return existing;
  const { data: script, error } = await admin().from('script_versions').select('*').eq('production_id', productionId).eq('version', version).single();
  if (error || !script) throw new Error(`Script version ${version} not found`);
  if (script.storage_path.startsWith('demo://')) throw new Error(`Demo breakdown for version ${version} was not seeded`);

  await admin().from('script_versions').update({ processing_status: 'PROCESSING', processing_error: null }).eq('id', script.id);
  const { data: blob, error: downloadError } = await admin().storage.from('scripts').download(script.storage_path);
  if (downloadError || !blob) throw new Error(`Download screenplay: ${downloadError?.message ?? 'file missing'}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Screenplay PDF exceeds OPTRANE Edge analysis limit of 20 MB');
  try {
    const breakdown = await breakdownPdf(bytes);
    await persistBreakdown(productionId, version, breakdown);
    return breakdown;
  } catch (error) {
    await admin().from('script_versions').update({ processing_status: 'FAILED', processing_error: error instanceof Error ? error.message : String(error) }).eq('id', script.id);
    throw error;
  }
}

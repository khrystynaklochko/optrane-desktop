import { admin } from './db.ts';
import type { SceneBreakdown } from './domain.ts';
import { persistBreakdown, rebuildDependencies } from './breakdown.ts';

export function nightfallV7(): SceneBreakdown[] {
  const scenes: SceneBreakdown[] = [];
  for (let i = 1; i <= 8; i++) {
    const number = i === 6 ? '42' : String(36 + i);
    const elements = [{ type: 'CAST', name: number === '42' ? 'Luna' : `Actor ${((i - 1) % 5) + 1}`, quantity: 1, confidence: 'EXPLICIT' as const }];
    if (number === '42') elements.push(
      { type: 'VEHICLE', name: 'Picture Vehicle 1', quantity: 1, confidence: 'EXPLICIT' as const },
      { type: 'LOCATION', name: 'Old Warehouse', quantity: 1, confidence: 'EXPLICIT' as const },
    );
    scenes.push({
      scene_number: number,
      heading: number === '42' ? 'EXT. OLD WAREHOUSE - NIGHT' : `INT. STAGE ${i} - DAY`,
      location: number === '42' ? 'Old Warehouse' : 'Stage 3',
      interior_exterior: number === '42' ? 'EXT' : 'INT',
      day_night: number === '42' ? 'NIGHT' : 'DAY',
      page_eighths: number === '42' ? 5 : 4,
      description: number === '42' ? 'Two adult actors. Standard camera setup. One picture vehicle.' : 'Demo production scene.',
      elements,
    });
  }
  return scenes;
}

export function nightfallV8(): SceneBreakdown[] {
  const scenes = structuredClone(nightfallV7());
  const scene = scenes.find((s) => s.scene_number === '42')!;
  scene.elements.push(
    { type: 'MINOR', name: 'Child performer', quantity: 1, confidence: 'EXPLICIT' },
    { type: 'SPECIAL_EQUIPMENT', name: 'Drone establishing shot', quantity: 1, confidence: 'EXPLICIT' },
    { type: 'STUNT', name: 'Vehicle stunt', quantity: 1, confidence: 'EXPLICIT' },
    { type: 'SPECIAL_EFFECT', name: 'Rain effect', quantity: 1, confidence: 'EXPLICIT' },
  );
  return scenes;
}

async function audit(productionId: string, eventType: string, actor: string, summary: string, payload: Record<string, unknown> = {}) {
  const { error } = await admin().from('audit_events').insert({ production_id: productionId, event_type: eventType, actor, summary, source: 'DEMO', payload });
  if (error) throw new Error(`demo audit: ${error.message}`);
}

export async function resetNightfall(userId: string) {
  const { data: existing } = await admin().from('productions').select('id').eq('owner_id', userId).eq('demo', true);
  if (existing?.length) {
    const ids = existing.map((row) => row.id);
    await admin().from('productions').delete().in('id', ids);
  }

  const { data: production, error } = await admin().from('productions').insert({
    owner_id: userId, title: 'NIGHTFALL', status: 'ACTIVE', current_script_version: 7, readiness: 94,
    planned_cost: 41200, scenes_count: 8, crew_count: 26, cast_count: 6, locations_count: 2,
    shoot_day_label: 'Tomorrow', demo: true,
  }).select('*').single();
  if (error) throw new Error(`create demo production: ${error.message}`);

  await admin().from('production_members').insert({ production_id: production.id, user_id: userId, role: 'OWNER' });
  await admin().from('script_versions').insert({
    production_id: production.id, version: 7, kind: 'BASELINE', filename: 'nightfall_v7.pdf', storage_path: 'demo://nightfall_v7.pdf',
    processing_status: 'READY', created_by: userId,
  });
  await persistBreakdown(production.id, 7, nightfallV7());
  await rebuildDependencies(production.id, nightfallV7());

  await admin().from('cast_members').insert([
    { production_id: production.id, name: 'Luna', character_name: 'Luna' },
    ...Array.from({ length: 5 }, (_, i) => ({ production_id: production.id, name: `Cast ${i + 2}`, character_name: `Role ${i + 2}` })),
  ]);
  await admin().from('locations').insert([
    { production_id: production.id, name: 'Old Warehouse', availability_until: '23:00', status: 'CONFIRMED' },
    { production_id: production.id, name: 'Stage 3', availability_until: '22:00', status: 'CONFIRMED' },
  ]);
  const tomorrow = new Date(Date.now() + 86400000);
  const scene44Start = new Date(tomorrow); scene44Start.setUTCHours(18, 0, 0, 0);
  const scene42Start = new Date(tomorrow); scene42Start.setUTCHours(20, 0, 0, 0);
  await admin().from('schedule_items').insert([
    { production_id: production.id, shoot_day: 8, scene_number: '44', starts_at: scene44Start.toISOString(), status: 'PLANNED' },
    { production_id: production.id, shoot_day: 8, scene_number: '42', starts_at: scene42Start.toISOString(), status: 'PLANNED' },
  ]);
  await admin().from('call_sheets').insert({ production_id: production.id, shoot_day: 8, script_version: 7, status: 'ISSUED', payload: { crew_call: '16:00' } });
  await admin().from('production_facts').insert([
    { production_id: production.id, fact_type: 'PERMIT', entity_id: 'drone-authorization', state: 'MISSING', payload: {} },
    { production_id: production.id, fact_type: 'CREW_ROLE', entity_id: 'stunt-coordinator', state: 'MISSING', payload: {} },
    { production_id: production.id, fact_type: 'WORK_RULE', entity_id: 'minor-work-verification', state: 'UNVERIFIED', payload: {} },
    { production_id: production.id, fact_type: 'VEHICLE_ALLOCATION', entity_id: 'day-8', state: 'AT_CAPACITY', payload: { used: 1, capacity: 1 } },
    { production_id: production.id, fact_type: 'LOCATION_AVAILABILITY', entity_id: 'old-warehouse', state: 'CONFIRMED', payload: { until: '23:00' } },
  ]);
  await audit(production.id, 'DEMO_RESET', 'OPTRANE', 'NIGHTFALL baseline restored', { script_version: 7, readiness: 94 });
  return production.id;
}

export async function loadNightfallRevision(userId: string) {
  const { data: production, error } = await admin().from('productions').select('*').eq('owner_id', userId).eq('demo', true).maybeSingle();
  if (error || !production) throw new Error('Reset the NIGHTFALL demo before loading the revision');
  const { data: existing } = await admin().from('script_versions').select('id').eq('production_id', production.id).eq('version', 8).maybeSingle();
  if (!existing) {
    await admin().from('script_versions').insert({
      production_id: production.id, version: 8, kind: 'REVISION', filename: 'nightfall_v8.pdf', storage_path: 'demo://nightfall_v8.pdf',
      processing_status: 'READY', created_by: userId,
    });
    await persistBreakdown(production.id, 8, nightfallV8());
  }
  await admin().from('productions').update({ current_script_version: 8 }).eq('id', production.id);
  await audit(production.id, 'REVISION_UPLOADED', 'Producer', 'Script v8 loaded from demo fixture');
  return { productionId: production.id, version: 8 };
}

export function nightfallRevisionPreview() {
  return [
    { id: 'demo-change-minor', scene: '42', type: 'ELEMENT_ADDED', category: 'MINOR', label: 'Child performer' },
    { id: 'demo-change-drone', scene: '42', type: 'ELEMENT_ADDED', category: 'SPECIAL_EQUIPMENT', label: 'Drone establishing shot' },
    { id: 'demo-change-stunt', scene: '42', type: 'ELEMENT_ADDED', category: 'STUNT', label: 'Vehicle stunt' },
    { id: 'demo-change-rain', scene: '42', type: 'ELEMENT_ADDED', category: 'SPECIAL_EFFECT', label: 'Artificial rain' },
  ];
}

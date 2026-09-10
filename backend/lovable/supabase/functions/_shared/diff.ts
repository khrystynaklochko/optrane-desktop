import type { SceneBreakdown, SceneChange } from './domain.ts';
import { sceneHash } from './breakdown.ts';

export async function deterministicSceneDiff(oldScenes: SceneBreakdown[], newScenes: SceneBreakdown[]): Promise<SceneChange[]> {
  const oldBy = new Map(oldScenes.map((s) => [s.scene_number, s]));
  const newBy = new Map(newScenes.map((s) => [s.scene_number, s]));
  const numbers = [...new Set([...oldBy.keys(), ...newBy.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const changes: SceneChange[] = [];

  for (const sceneNumber of numbers) {
    const before = oldBy.get(sceneNumber);
    const after = newBy.get(sceneNumber);
    if (!before && after) {
      changes.push({ id: crypto.randomUUID(), scene_number: sceneNumber, change_type: 'SCENE_ADDED', category: 'SCENE', new_value: after.heading, label: `Scene ${sceneNumber} added` });
      continue;
    }
    if (before && !after) {
      changes.push({ id: crypto.randomUUID(), scene_number: sceneNumber, change_type: 'SCENE_REMOVED', category: 'SCENE', old_value: before.heading, label: `Scene ${sceneNumber} removed` });
      continue;
    }
    if (!before || !after) continue;
    if (await sceneHash(before) === await sceneHash(after)) continue;

    if (before.location !== after.location) {
      changes.push({ id: crypto.randomUUID(), scene_number: sceneNumber, change_type: 'LOCATION_CHANGED', category: 'LOCATION', old_value: before.location, new_value: after.location, label: `Location: ${before.location} → ${after.location}` });
    }
    if (before.day_night !== after.day_night) {
      changes.push({ id: crypto.randomUUID(), scene_number: sceneNumber, change_type: 'DAY_NIGHT_CHANGED', category: 'SCHEDULE', old_value: before.day_night, new_value: after.day_night, label: `${before.day_night} → ${after.day_night}` });
    }

    const oldElements = new Map(before.elements.map((e) => [`${e.type.toUpperCase()}::${e.name.trim().toLowerCase()}`, e]));
    const newElements = new Map(after.elements.map((e) => [`${e.type.toUpperCase()}::${e.name.trim().toLowerCase()}`, e]));
    for (const [key, element] of [...newElements.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!oldElements.has(key)) {
        changes.push({ id: crypto.randomUUID(), scene_number: sceneNumber, change_type: 'ELEMENT_ADDED', category: element.type.toUpperCase(), new_value: element.name, label: element.name });
      }
    }
    for (const [key, element] of [...oldElements.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!newElements.has(key)) {
        changes.push({ id: crypto.randomUUID(), scene_number: sceneNumber, change_type: 'ELEMENT_REMOVED', category: element.type.toUpperCase(), old_value: element.name, label: `Removed ${element.name}` });
      }
    }
    if (before.page_eighths !== after.page_eighths) {
      changes.push({ id: crypto.randomUUID(), scene_number: sceneNumber, change_type: 'PAGE_COUNT_CHANGED', category: 'SCHEDULE', old_value: String(before.page_eighths), new_value: String(after.page_eighths), label: 'Page count changed' });
    }
  }
  return changes;
}

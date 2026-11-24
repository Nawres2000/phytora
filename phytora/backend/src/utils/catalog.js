import fs from 'fs';

const CATALOG = JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf-8'));

export const catalogList = () => Object.entries(CATALOG).map(([id, v]) => ({ id, ...v }));
export const isClass = (id) => typeof id === 'string' && Object.hasOwn(CATALOG, id);

// French display info for a model class id (falls back to the raw id if the catalog doesn't know it)
export function describeClass(id) {
  const c = CATALOG[id];
  if (c) return { class_id: id, plant_species: c.plant, disease: c.disease, is_healthy: c.healthy };
  const [plant, disease = ''] = String(id).split('___').map((s) => s.replace(/_/g, ' '));
  return { class_id: id, plant_species: plant, disease, is_healthy: /healthy/i.test(disease) };
}

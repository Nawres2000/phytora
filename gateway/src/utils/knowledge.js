// Retrieval over the disease catalog (RAG): the assistant answers from these reference sheets
// and cites them, instead of relying only on what the language model remembers.
import { catalogList } from './catalog.js';

const STOP = new Set(('les des une est que qui pour pas sur avec dans par plus mon mes ma son ses leur nos vos ces cet cette quoi comment '
  + 'quel quelle quels quelles faire peut dois elle ils elles vous nous suis sont ont aux the and for what how does can with this that '
  + 'from are its your have has était avoir être fait faut aussi bien tres très car donc mais comme ou où').split(/\s+/));
const SYNONYMS = { tomato: 'tomate', potato: 'pomme de terre', patate: 'pomme de terre', corn: 'mais', maize: 'mais', grape: 'raisin', vigne: 'raisin',
  apple: 'pomme', pommier: 'pomme', pepper: 'poivron', peach: 'peche', cherry: 'cerise', strawberry: 'fraise', squash: 'courge',
  courgette: 'courge', blueberry: 'myrtille', raspberry: 'framboise', soybean: 'soja', citrus: 'orange', agrume: 'orange' };

export const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function tokens(s) {
  return normalize(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .map((w) => (w.length > 4 ? w.replace(/(s|x)$/, '') : w)) // light plural stemming: tomates -> tomate
    .map((w) => SYNONYMS[w] || w).flatMap((w) => w.split(' '))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

const DOCS = catalogList().map((c) => {
  const title = `${c.plant} : ${c.disease}`;
  const head = new Set(tokens(`${c.plant} ${c.disease} ${c.id.replace(/[_()]/g, ' ')}`));
  const body = tokens(`${c.symptoms} ${c.prevention}`);
  return { id: c.id, title, entry: c, head, terms: new Set([...head, ...body]) };
});
const DF = new Map();
for (const d of DOCS) for (const t of d.terms) DF.set(t, (DF.get(t) || 0) + 1);
const idf = (t) => Math.log(1 + DOCS.length / (DF.get(t) || DOCS.length));

// Top-k sheets for a question; `prefer` (the diagnosed class) is always first when given
export function retrieve(question, { prefer, k = 3, minScore = 2 } = {}) {
  const q = new Set(tokens(question));
  const scored = DOCS.map((d) => {
    let score = 0;
    for (const t of q) if (d.terms.has(t)) score += idf(t) * (d.head.has(t) ? 2 : 1);
    return { d, score };
  }).filter((x) => x.score >= minScore && x.d.id !== prefer).sort((a, b) => b.score - a.score);
  const out = scored.slice(0, k).map((x) => x.d);
  const p = prefer && DOCS.find((d) => d.id === prefer);
  return (p ? [p, ...out] : out).slice(0, k);
}

export function contextBlock(docs) {
  if (!docs.length) return '';
  return '\n\nREFERENCE SHEETS (PHYTORA disease guide). Base your answer on them and cite them as [1], [2]... when you use them:\n'
    + docs.map((d, i) => {
      const e = d.entry;
      const links = (e.links || []).map((l) => `${l.title} <${l.url}>`).join('; ');
      return `[${i + 1}] ${d.title}${e.healthy ? ' (healthy plant)' : ''}\nSymptoms: ${e.symptoms}\nPrevention: ${e.prevention}${links ? `\nLinks: ${links}` : ''}`;
    }).join('\n');
}

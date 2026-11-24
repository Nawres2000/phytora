import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import Scan from '../models/Scan.js';
import { sniffImage } from '../utils/image.js';
import { catalogList, describeClass } from '../utils/catalog.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 } });
const short = (v, n = 80) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);

r.get('/catalog', requireAuth, (req, res) => res.json({ classes: catalogList() }));

// Which model features are available right now (the UI disables what isn't)
r.get('/model/status', requireAuth, async (req, res) => {
  try {
    const resp = await fetch(`${process.env.MODEL_API_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const h = await resp.json();
    res.json({ online: true, classification: !!h.classification, detection: !!h.detection, mock: !!h.mock, model_version: h.model_version ?? null });
  } catch {
    res.json({ online: false, classification: false, detection: false, mock: false, model_version: null });
  }
});

// Image -> FastAPI model -> French result (also saved in the user's history)
r.post('/predict', requireAuth, upload.single('file'), async (req, res) => {
  const task = req.query.task === 'detection' ? 'detection' : 'classification';
  if (!req.file) return res.status(400).json({ error: "Ajoutez d'abord une image." });
  const mime = sniffImage(req.file.buffer);
  if (!mime) return res.status(400).json({ error: "Format d'image non pris en charge (JPEG, PNG ou WebP)." });

  let data;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([req.file.buffer], { type: mime }), 'upload');
    const resp = await fetch(`${process.env.MODEL_API_URL}/predict?task=${task}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
    data = await resp.json().catch(() => ({}));
    if (!resp.ok) return res.status(502).json({ error: typeof data.detail === 'string' ? data.detail : "Le modèle n'a pas pu analyser cette image." });
  } catch {
    return res.status(502).json({ error: 'Le service du modèle est injoignable. FastAPI est-il lancé ?' });
  }

  const out = { task, latency_ms: data.latency_ms, mock: !!data.mock, model_version: data.model_version ?? null };
  const scanData = { user: req.userId, task, latencyMs: data.latency_ms, mock: out.mock, modelVersion: out.model_version };
  if (task === 'classification') {
    const top = (data.top_k || []).map((c) => ({ ...describeClass(c.class_id), score: c.score }));
    if (!top.length) return res.status(502).json({ error: "Le modèle n'a renvoyé aucun résultat." });
    const best = top[0];
    Object.assign(out, {
      disease: { class_id: best.class_id, plant_species: best.plant_species, disease: best.disease, is_healthy: best.is_healthy, confidence: best.score },
      top_k: top, uncertain: !!data.uncertain, heatmap: data.heatmap || null,
    });
    Object.assign(scanData, {
      classId: best.class_id, plant: best.plant_species, disease: best.disease, isHealthy: best.is_healthy, confidence: best.score,
      uncertain: out.uncertain, topK: top.map((t) => ({ classId: t.class_id, score: t.score })),
    });
  } else {
    Object.assign(out, { counts: data.counts, predictions: data.predictions || [] });
    Object.assign(scanData, { weeds: data.counts?.weeds, crops: data.counts?.crops });
  }
  const thumb = req.body?.thumb;
  if (typeof thumb === 'string' && /^data:image\/jpeg;base64,/.test(thumb) && thumb.length <= 40000) scanData.thumb = thumb;
  const scan = await Scan.create(scanData);
  res.json({ ...out, scanId: scan._id });
});

function describe(d) {
  if (!d || typeof d !== 'object') return '';
  const note = d.mock ? ' (demo result, not reliable)' : '';
  if (d.task === 'detection' && d.counts)
    return ` The user's last image analysis found ${Number(d.counts.weeds) || 0} weeds and ${Number(d.counts.crops) || 0} crop plants${note}.`;
  const x = d.disease;
  if (!x) return '';
  const alts = Array.isArray(d.top_k) ? d.top_k.slice(1, 3).map((c) => `${short(c.plant_species, 40)} ${short(c.disease, 50)} (${Math.round((Number(c.score) || 0) * 100)}%)`).join('; ') : '';
  return ` The model's last diagnosis for the user's photo: plant "${short(x.plant_species)}", ${x.is_healthy ? 'healthy' : `disease "${short(x.disease)}"`}, confidence ${Math.round((Number(x.confidence) || 0) * 100)}%${d.uncertain ? ', flagged UNCERTAIN by the model (say so and suggest retaking a clearer photo)' : ''}${alts ? `; other candidates: ${alts}` : ''}${note}.`;
}

// Chatbot (Groq, OpenAI-compatible endpoint)
r.post('/chat', requireAuth, async (req, res) => {
  const { messages = [], diagnosis } = req.body;
  const system = 'You are the PHYTORA assistant, a friendly plant pathology and crop care advisor. Reply in the same language as the user (French by default). Give practical, concise advice on plant diseases, treatment and prevention, and say when you are unsure and a local agronomist should check. Do not give pesticide dosages. The model diagnosis below is an AI estimate trained on lab photos: treat it as a hint, not a certainty.' + describe(diagnosis);
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: system }, ...messages.slice(-10).filter((m) => ['user', 'assistant'].includes(m.role)).map(({ role, content }) => ({ role, content: String(content).slice(0, 2000) }))],
        temperature: 0.5,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message);
    res.json({ reply: data.choices[0].message.content });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "L'assistant est indisponible. Vérifiez votre clé API Groq puis réessayez." });
  }
});

export default r;

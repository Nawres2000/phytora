import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import Scan from '../models/Scan.js';
import { sniffImage } from '../utils/image.js';
import { describeClass } from '../utils/catalog.js';

// Gateway between the web app and the FastAPI model service (MODEL_API_URL):
// it authenticates the user, checks the real file type, saves the history and translates class ids to French.
const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 } });
const MODEL = () => process.env.MODEL_API_URL;

async function callModel(path, { method = 'GET', body, timeout = 30000 } = {}) {
  let resp;
  try {
    resp = await fetch(`${MODEL()}${path}`, { method, body, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw Object.assign(new Error('Le service du modèle est injoignable. FastAPI est-il lancé ?'), { status: 502 });
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = typeof data.detail === 'string' ? data.detail : "Le modèle n'a pas pu analyser cette image.";
    throw Object.assign(new Error(msg), { status: resp.status === 503 ? 503 : 502 });
  }
  return data;
}

function imageForm(req) {
  if (!req.file) throw Object.assign(new Error("Ajoutez d'abord une image."), { status: 400 });
  const mime = sniffImage(req.file.buffer);
  if (!mime) throw Object.assign(new Error("Format d'image non pris en charge (JPEG, PNG ou WebP)."), { status: 400 });
  const fd = new FormData();
  fd.append('file', new Blob([req.file.buffer], { type: mime }), 'upload');
  return fd;
}

// FastAPI answer -> what the web app displays (French names from the catalog)
export function toClient(data) {
  const top = (data.top_k || []).map((c) => ({ ...describeClass(c.class_id), score: c.score }));
  if (!top.length) throw Object.assign(new Error("Le modèle n'a renvoyé aucun résultat."), { status: 502 });
  const best = top[0];
  return {
    task: 'classification',
    disease: { class_id: best.class_id, plant_species: best.plant_species, disease: best.disease, is_healthy: best.is_healthy, confidence: best.score },
    top_k: top,
    uncertain: !!data.uncertain,
    severity: data.severity || null,
    heatmap: data.heatmap || null,
    latency_ms: data.latency_ms,
    latency: data.latency || null,
    engine: data.engine,
    variant: data.variant,
    mock: !!data.mock,
    model_version: data.model_version ?? null,
  };
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (!e.status) throw e;
    res.status(e.status).json({ error: e.message });
  }
};

// Which features are available right now (the UI disables what isn't)
r.get('/model/status', requireAuth, async (req, res) => {
  try {
    const h = await callModel('/health', { timeout: 2000 });
    res.json({ online: true, classification: !!h.model_loaded, explain: !!h.explain_available, mock: !!h.mock,
      model_version: h.model_version ?? null, engine: h.engine, variant: h.variant, gpu: h.gpu });
  } catch {
    res.json({ online: false, classification: false, explain: false, mock: false, model_version: null });
  }
});

r.get('/model/metadata', requireAuth, wrap(async (req, res) => {
  res.json(await callModel('/model/metadata', { timeout: 5000 }));
}));

// Image -> FastAPI -> French result, saved in the user's history
r.post('/predict', requireAuth, upload.single('file'), wrap(async (req, res) => {
  const t0 = performance.now();
  const method = req.query.method === 'scorecam' ? 'scorecam' : 'gradcam';
  const data = await callModel(`/predict?explain=true&method=${method}`, { method: 'POST', body: imageForm(req) });
  const out = toClient(data);
  const d = out.disease;
  const scan = {
    user: req.userId, classId: d.class_id, plant: d.plant_species, disease: d.disease, isHealthy: d.is_healthy, confidence: d.confidence,
    uncertain: out.uncertain, topK: out.top_k.map((t) => ({ classId: t.class_id, score: t.score })), severity: out.severity || undefined,
    latencyMs: data.latency_ms, inferenceMs: data.latency?.inference_ms, mock: out.mock, modelVersion: out.model_version, engine: out.engine,
  };
  const thumb = req.body?.thumb;
  if (typeof thumb === 'string' && /^data:image\/jpeg;base64,/.test(thumb) && thumb.length <= 40000) scan.thumb = thumb;
  const saved = await Scan.create(scan);
  res.json({ ...out, scanId: saved._id, gateway_ms: Math.round(performance.now() - t0) });
}));

// Live webcam frames: fast path, no heat map, nothing saved
r.post('/predict/live', requireAuth, upload.single('file'), wrap(async (req, res) => {
  const t0 = performance.now();
  const data = await callModel('/predict?explain=false&severity=false&top_k=3', { method: 'POST', body: imageForm(req), timeout: 10000 });
  res.json({ ...toClient(data), gateway_ms: Math.round(performance.now() - t0) });
}));

export default r;

'use client';
import { useEffect, useState } from 'react';
import { Cpu, ExternalLink, Gauge, Layers, FlaskConical, BarChart3, ListTree, Play } from 'lucide-react';
import { api, API } from '@/lib/api';
import { Bar } from '@/components/ClassificationResult';

const SWAGGER = `${process.env.NEXT_PUBLIC_MODEL_API_URL || 'http://localhost:8000'}/docs`;
const MLFLOW = process.env.NEXT_PUBLIC_MLFLOW_URL || 'http://localhost:5001';
const f = (v, d = 1) => (v == null ? '–' : (Math.round(v * 10 ** d) / 10 ** d).toString());
const pc = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)} %`);
const LABELS = { baseline_cnn: 'CNN baseline (from scratch)', mobilenet_v3_small: 'MobileNetV3-Small (transfer learning)', efficientnet_v2_s: 'EfficientNetV2-S', convnext_tiny: 'ConvNeXt-Tiny' };

function Card({ icon: Icon, title, children, className = '' }) {
  return (
    <section className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-6 ${className}`}>
      <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Icon size={18} className="text-phytora-mid" /> {title}</h2>
      {children}
    </section>
  );
}

function Stat({ value, label }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <p className="text-2xl font-extrabold text-phytora-dark tabular-nums">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

export default function ModelPage() {
  const [m, setM] = useState(null), [status, setStatus] = useState(null), [error, setError] = useState('');
  const [bench, setBench] = useState({ running: false, rows: [] });

  useEffect(() => {
    api('/model/metadata').then(setM).catch((e) => setError(e.message));
    api('/model/status').then(setStatus).catch(() => {});
  }, []);

  // 10 real requests from this browser: client-side vs server-side latency
  async function runBenchmark() {
    setBench({ running: true, rows: [] });
    const blob = await (await fetch('/examples/feuille.jpg')).blob();
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.append('file', new File([blob], 'feuille.jpg', { type: 'image/jpeg' }));
      const t0 = performance.now();
      try {
        const res = await fetch(`${API}/predict/live`, { method: 'POST', body: form, credentials: 'include' });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        rows.push({ client: performance.now() - t0, server: d.latency?.total_ms ?? d.latency_ms, inference: d.latency?.inference_ms });
      } catch (e) { setError(e.message || 'Mesure impossible.'); break; }
      setBench({ running: true, rows: [...rows] });
    }
    setBench({ running: false, rows });
  }
  const avg = (k) => (bench.rows.length ? bench.rows.reduce((s, r) => s + (r[k] || 0), 0) / bench.rows.length : null);
  const p95 = (k) => { const v = bench.rows.map((r) => r[k]).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(0.95 * v.length))] : null; };

  const metrics = m?.metrics || {};
  const benchmark = Object.entries(m?.benchmark || {});
  const variants = Object.entries(m?.variants || {});
  const maxLat = Math.max(...variants.map(([, v]) => v.latency_ms?.mean_ms || 0), m?.latency_pytorch_ms?.mean_ms || 0, 1);
  const maxSize = Math.max(...variants.map(([, v]) => v.size_mb || 0), 1);

  return (
    <div className="p-6 md:p-12 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Modèle IA &amp; MLOps</h1>
        <p className="text-gray-500">Ce que sert l’API en ce moment : architecture, performances mesurées, optimisation ONNX et outils de suivi.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <a href={SWAGGER} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-phytora-dark text-white text-sm hover:bg-phytora-mid"><ExternalLink size={14} /> API FastAPI (Swagger)</a>
          <a href={MLFLOW} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-100"><ExternalLink size={14} /> MLflow (runs &amp; registre)</a>
        </div>
      </header>
      {error && <p role="alert" className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100">{error}</p>}
      {!m && !error && <p className="text-gray-500">Chargement…</p>}

      {m && (
        <>
          <Card icon={Cpu} title="Modèle en production">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat value={LABELS[m.architecture]?.split(' (')[0] || m.architecture} label="Architecture" />
              <Stat value={m.num_classes} label="Classes (PlantVillage)" />
              <Stat value={`${m.img_size}²`} label="Taille d’entrée (px)" />
              <Stat value={`${m.engine}${m.serve_variant && m.serve_variant !== 'none' ? ` · ${m.serve_variant}` : ''}`} label={status?.gpu?.available ? `GPU ${status.gpu.name || ''}` : 'Exécution CPU'} />
            </div>
            <p className="text-xs text-gray-400 mt-3 font-mono break-all">{m.version} · {m.framework}{m.exported_at && ` · exporté le ${new Date(m.exported_at).toLocaleString('fr-FR')}`}</p>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card icon={BarChart3} title="Performances (jeu de test)">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Stat value={pc(metrics.test_acc)} label="Exactitude (test)" />
                <Stat value={pc(metrics.test_macro_f1)} label="F1 macro (test)" />
                <Stat value={pc(metrics.best_val_macro_f1)} label="F1 macro (validation)" />
                <Stat value={metrics.test_top3_acc != null ? pc(metrics.test_top3_acc) : f(metrics.test_loss, 3)} label={metrics.test_top3_acc != null ? 'Top-3 (test)' : 'Perte (test)'} />
              </div>
              <p className="text-xs text-gray-500">Split stratifié 70/15/15 après retrait des doublons (MD5) et regroupement des quasi-doublons (dHash). Le F1 macro compte chaque classe à égalité malgré le déséquilibre.</p>
            </Card>

            <Card icon={Layers} title="Baseline vs modèle avancé">
              {benchmark.length === 0 ? <p className="text-sm text-gray-500">Lancez plusieurs expériences (dvc exp run) pour remplir ce comparatif.</p> : (
                <ul className="space-y-4">
                  {benchmark.map(([name, b]) => (
                    <li key={name}>
                      <p className="text-sm font-medium text-gray-700 mb-1">{LABELS[name] || name}{name === m.architecture && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-phytora-light/20 text-phytora-dark">servi</span>}</p>
                      <div className="text-xs text-gray-500 flex justify-between"><span>Exactitude</span><span className="tabular-nums">{pc(b.test_acc)}</span></div>
                      <Bar value={100 * (b.test_acc || 0)} className={name === m.architecture ? 'bg-phytora-dark' : 'bg-gray-400'} />
                      <div className="text-xs text-gray-500 flex justify-between mt-1"><span>F1 macro</span><span className="tabular-nums">{pc(b.test_macro_f1)}</span></div>
                      <Bar value={100 * (b.test_macro_f1 || 0)} className={name === m.architecture ? 'bg-phytora-light' : 'bg-gray-300'} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card icon={Gauge} title="Optimisation : PyTorch → ONNX (FP32, FP16, INT8)">
            {variants.length === 0 ? <p className="text-sm text-gray-500">Aucune variante ONNX décrite.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 text-xs uppercase"><th className="py-2 pr-4">Variante</th><th className="pr-4">Taille</th><th className="pr-4 min-w-40">Latence CPU (1 image)</th><th className="pr-4">Exactitude*</th><th>Accord avec FP32</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {m.latency_pytorch_ms && (
                      <tr><td className="py-3 pr-4 font-medium">PyTorch (référence)</td><td className="pr-4">–</td>
                        <td className="pr-4"><span className="font-mono text-xs">{f(m.latency_pytorch_ms.mean_ms, 2)} ms</span><Bar value={(100 * m.latency_pytorch_ms.mean_ms) / maxLat} className="bg-gray-400" height="h-1.5" /></td><td className="pr-4">–</td><td>–</td></tr>
                    )}
                    {variants.map(([k, v]) => (
                      <tr key={k} className={k === m.serve_variant ? 'bg-phytora-light/5' : ''}>
                        <td className="py-3 pr-4 font-medium">ONNX {k.toUpperCase()} {k === m.serve_variant && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-phytora-light/20 text-phytora-dark">servie</span>}</td>
                        <td className="pr-4 min-w-28"><span className="font-mono text-xs">{f(v.size_mb, 2)} Mo</span><Bar value={(100 * (v.size_mb || 0)) / maxSize} className="bg-phytora-accent" height="h-1.5" /></td>
                        <td className="pr-4">{v.error ? <span className="text-xs text-red-600">{v.error.slice(0, 60)}</span> : <><span className="font-mono text-xs">{f(v.latency_ms?.mean_ms, 2)} ms (p95 {f(v.latency_ms?.p95_ms, 2)})</span><Bar value={(100 * (v.latency_ms?.mean_ms || 0)) / maxLat} className="bg-phytora-mid" height="h-1.5" /></>}</td>
                        <td className="pr-4 tabular-nums">{pc(v.acc)}</td>
                        <td className="tabular-nums">{v.agreement_with_fp32 != null ? pc(v.agreement_with_fp32) : k === 'fp32' ? 'référence' : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-500 mt-3">
                  Parité PyTorch/ONNX : écart max des logits {m.parity_pytorch_onnx ? m.parity_pytorch_onnx.max_abs_logit_diff.toExponential(1) : '–'}.
                  {m.int8_quantization && ` INT8 : quantification statique calibrée sur des images d’entraînement ; ${m.int8_quantization.layers_kept_fp32.length} couche(s) sur ${m.int8_quantization.layers_total} gardée(s) en FP32 après analyse de sensibilité (la quantification complète faisait chuter l’exactitude).`}
                  {' '}*Exactitude mesurée sur {variants[0]?.[1]?.images ?? '–'} images non vues pendant la calibration.
                </p>
              </div>
            )}
          </Card>

          <Card icon={FlaskConical} title="Mesure en direct depuis votre navigateur">
            <p className="text-sm text-gray-500 mb-3">Envoie 10 fois une image d’exemple au modèle (sans enregistrement) et compare la latence vue par le navigateur à celle mesurée par le serveur.</p>
            <button onClick={runBenchmark} disabled={bench.running} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-phytora-dark text-white text-sm font-semibold hover:bg-phytora-mid disabled:opacity-50"><Play size={15} /> {bench.running ? `Mesure… ${bench.rows.length}/10` : 'Lancer la mesure'}</button>
            {bench.rows.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-4">
                <Stat value={`${f(avg('client'), 0)} ms`} label={`Client (aller-retour) · p95 ${f(p95('client'), 0)} ms`} />
                <Stat value={`${f(avg('server'), 1)} ms`} label={`Serveur FastAPI · p95 ${f(p95('server'), 1)} ms`} />
                <Stat value={`${f(avg('inference'), 1)} ms`} label="Inférence ONNX seule" />
              </div>
            )}
          </Card>

          <Card icon={ListTree} title={`Les ${m.num_classes} classes reconnues`}>
            <details>
              <summary className="cursor-pointer text-sm text-phytora-accent">Afficher la liste</summary>
              <ul className="mt-3 grid sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs text-gray-600 font-mono">
                {m.classes.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </details>
          </Card>
        </>
      )}
    </div>
  );
}

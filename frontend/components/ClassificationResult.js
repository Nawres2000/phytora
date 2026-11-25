'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, ThumbsUp, ThumbsDown, TriangleAlert, FlaskConical, CheckCircle2, Timer, MessageCircle, Activity } from 'lucide-react';
import { api, API } from '@/lib/api';

const pct = (v) => Math.round((v ?? 0) * 100);
const SEVERITY_TONE = { faible: 'bg-green-500', modérée: 'bg-amber-400', élevée: 'bg-orange-500', sévère: 'bg-red-600' };

/** Bar that grows from 0 to its value when it appears (CSS animation, see globals.css). */
export function Bar({ value, className = 'bg-phytora-mid', height = 'h-2' }) {
  return (
    <div className={`w-full bg-gray-100 rounded-full overflow-hidden ${height}`}>
      <div className={`${height} rounded-full bar-grow ${className}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function LatencyPanel({ r }) {
  const rows = [
    ['Navigateur → réponse (client)', r.client_ms],
    ['Passerelle (Express)', r.gateway_ms],
    ['API FastAPI (serveur)', r.latency?.total_ms ?? r.latency_ms],
    ['dont prétraitement', r.latency?.preprocess_ms],
    ['dont inférence ONNX', r.latency?.inference_ms],
    ['dont Grad-CAM', r.latency?.explain_ms],
  ].filter(([, v]) => v != null);
  const max = Math.max(...rows.map(([, v]) => v), 1);
  return (
    <details className="group rounded-xl border border-gray-100 bg-gray-50/60 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-700 flex items-center gap-2"><Timer size={16} /> Temps de réponse : {r.client_ms ?? r.latency_ms} ms côté client · inférence {r.latency?.inference_ms ?? '–'} ms</summary>
      <ul className="mt-3 space-y-2">
        {rows.map(([label, v]) => (
          <li key={label} className="text-xs">
            <div className="flex justify-between text-gray-600"><span>{label}</span><span className="font-mono">{Math.round(v * 10) / 10} ms</span></div>
            <Bar value={(100 * v) / max} className="bg-phytora-accent" height="h-1.5" />
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-400 mt-2">Moteur : {r.engine}{r.variant && ` · variante ${r.variant}`} · modèle {r.model_version}</p>
    </details>
  );
}

export default function ClassificationResult({ result, file, preview, onDiscuss }) {
  const { disease: d, top_k: top = [], uncertain, heatmap, mock, scanId, severity } = result;
  const [view, setView] = useState('photo');
  const [sevImg, setSevImg] = useState({ url: null, error: '' });
  const [fb, setFb] = useState({ step: 'ask', classes: null, actual: '', error: '' });

  async function send(correct, actualClass) {
    try {
      await api(`/scans/${scanId}/feedback`, { method: 'PATCH', json: { correct, ...(actualClass && { actualClass }) } });
      setFb((f) => ({ ...f, step: 'done', error: '' }));
    } catch (e) { setFb((f) => ({ ...f, error: e.message })); }
  }
  async function wrong() {
    setFb((f) => ({ ...f, step: 'wrong' }));
    if (!fb.classes) { try { const c = await api('/catalog'); setFb((f) => ({ ...f, classes: c.classes })); } catch {} }
  }
  async function showSeverity() {
    setView('severity');
    if (sevImg.url || !file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API}/predict/visualize?overlay=severity`, { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Masque indisponible.');
      setSevImg({ url: URL.createObjectURL(await res.blob()), error: '' });
    } catch (e) { setSevImg({ url: null, error: e.message }); }
  }

  const tone = uncertain ? 'bg-amber-400' : d.is_healthy ? 'bg-green-500' : 'bg-red-500';
  const views = [['photo', 'Ma photo'], ...(heatmap ? [['heat', 'Zones analysées (Grad-CAM)']] : []), ...(!d.is_healthy && file ? [['severity', 'Zones atteintes']] : [])];

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border-t-4 border-phytora-accent space-y-5">
      {mock && (
        <p className="p-3 rounded-xl bg-phytora-warn/15 text-amber-800 text-sm flex items-center gap-2">
          <FlaskConical size={16} /> Résultat de démonstration : ce diagnostic est aléatoire.
        </p>
      )}
      {uncertain && (
        <div role="alert" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex gap-3">
          <TriangleAlert className="flex-shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-semibold">Le modèle n’est pas sûr de ce résultat.</p>
            <p>Reprenez la photo : une seule feuille, bien éclairée, nette, sur fond uni, sans ombre portée. Les pistes ci-dessous sont à prendre avec prudence.</p>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold mb-3">{uncertain ? 'Pistes possibles' : 'Résultat du diagnostic'}</h2>
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-4 h-4 rounded-full flex-shrink-0 ${tone}`} />
              <p className="text-lg"><span className="font-semibold">{d.plant_species}</span> : {d.disease}</p>
            </div>
            <Bar value={pct(d.confidence)} className={tone} height="h-3" />
            <p className="text-sm text-gray-500 mt-1">Confiance : <span className="tabular-nums font-semibold">{pct(d.confidence)} %</span></p>
          </div>

          {severity && !d.is_healthy && (
            <div className="rounded-xl border border-gray-100 p-4">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-2"><Activity size={16} /> Sévérité estimée</p>
              {severity.percent == null ? <p className="text-sm text-gray-500">Feuille trop petite ou fond trop chargé pour estimer la surface atteinte.</p> : (
                <>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-3xl font-extrabold tabular-nums">{severity.percent} %</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold text-white ${SEVERITY_TONE[severity.level] || 'bg-gray-400'}`}>{severity.level}</span>
                  </div>
                  <Bar value={severity.percent} className={SEVERITY_TONE[severity.level] || 'bg-gray-400'} />
                  <p className="text-[11px] text-gray-400 mt-2">Part de la surface de la feuille présentant des taches (analyse des couleurs, indicative).</p>
                </>
              )}
            </div>
          )}

          {top.length > 1 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Les {top.length} hypothèses du modèle</h3>
              <ul className="space-y-2.5">
                {top.map((c, i) => (
                  <li key={c.class_id} className="text-sm">
                    <div className="flex justify-between gap-3">
                      <Link href={`/dashboard/guide?class=${encodeURIComponent(c.class_id)}`} className="text-phytora-dark hover:underline">{c.plant_species} : {c.disease}</Link>
                      <span className="text-gray-500 tabular-nums">{pct(c.score)} %</span>
                    </div>
                    <Bar value={pct(c.score)} className={i === 0 ? 'bg-phytora-dark' : 'bg-phytora-light'} height="h-1.5" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Affichage de l’image">
            {views.map(([k, label]) => (
              <button key={k} onClick={() => (k === 'severity' ? showSeverity() : setView(k))} aria-pressed={view === k}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${view === k ? 'bg-phytora-dark text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{label}</button>
            ))}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {view === 'photo' && <img src={preview} alt="Votre photo" className="max-h-80 mx-auto rounded-lg object-contain" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {view === 'heat' && <img src={heatmap} alt="Carte de chaleur Grad-CAM" className="max-h-80 mx-auto rounded-lg object-contain" />}
          {view === 'severity' && (sevImg.url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={sevImg.url} alt="Zones atteintes en rouge" className="max-h-80 mx-auto rounded-lg object-contain" />
            : <p className="text-sm text-gray-500 text-center py-10">{sevImg.error || 'Calcul du masque…'}</p>)}
          {view === 'heat' && <p className="text-xs text-gray-500 mt-2 text-center">Les zones rouges ont le plus pesé dans la décision. Si elles tombent sur le fond et non sur la feuille, méfiez-vous du résultat.</p>}
          {view === 'severity' && sevImg.url && <p className="text-xs text-gray-500 mt-2 text-center">En rouge : les zones de la feuille dont la couleur s’écarte du vert sain.</p>}
        </div>
      </div>

      <LatencyPanel r={result} />

      <div className="flex flex-wrap gap-3">
        <Link href={`/dashboard/guide?class=${encodeURIComponent(d.class_id)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-phytora-dark bg-phytora-light/15 hover:bg-phytora-light/25 px-4 py-2 rounded-lg transition">
          <BookOpen size={16} /> Fiche : symptômes et prévention
        </Link>
        {onDiscuss && (
          <button onClick={() => onDiscuss(d.is_healthy ? 'Comment garder cette plante en bonne santé ?' : 'Que dois-je faire pour traiter cette maladie ?')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-phytora-dark hover:bg-phytora-mid px-4 py-2 rounded-lg transition">
            <MessageCircle size={16} /> Demander conseil à l’assistant
          </button>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4">
        {fb.step === 'ask' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700">Ce diagnostic est-il correct ?</span>
            <button onClick={() => send(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-green-50 hover:border-green-300"><ThumbsUp size={14} /> Oui</button>
            <button onClick={wrong} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-red-50 hover:border-red-300"><ThumbsDown size={14} /> Non</button>
          </div>
        )}
        {fb.step === 'wrong' && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Quel est le bon diagnostic ? (facultatif)
              <select value={fb.actual} onChange={(e) => setFb({ ...fb, actual: e.target.value })} className="input-phytora mt-1">
                <option value="">Je ne sais pas</option>
                {(fb.classes || []).map((c) => <option key={c.id} value={c.id}>{c.plant} : {c.disease}</option>)}
              </select>
            </label>
            <button onClick={() => send(false, fb.actual)} className="px-4 py-2 rounded-lg bg-phytora-dark text-white text-sm font-semibold hover:bg-phytora-mid">Envoyer</button>
          </div>
        )}
        {fb.step === 'done' && <p className="text-sm text-green-700 flex items-center gap-2"><CheckCircle2 size={16} /> Merci, votre retour aide à améliorer le modèle.</p>}
        {fb.error && <p role="alert" className="text-sm text-red-600 mt-2">{fb.error}</p>}
      </div>

      <p className="text-xs text-gray-400">Estimation par IA entraînée sur des photos de laboratoire (PlantVillage) : elle peut se tromper sur des photos prises au champ. En cas de doute, consultez un agronome.</p>
    </div>
  );
}

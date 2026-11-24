'use client';
import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, ThumbsUp, ThumbsDown, TriangleAlert, FlaskConical, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

export default function ClassificationResult({ result, preview }) {
  const { disease: d, top_k: top = [], uncertain, heatmap, mock, scanId } = result;
  const [view, setView] = useState('photo');
  const [fb, setFb] = useState({ step: 'ask', classes: null, actual: '', error: '' });
  const pct = (v) => Math.round(v * 100);

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

      <div>
        <h2 className="text-xl font-bold mb-3">{uncertain ? 'Pistes possibles' : 'Résultat du diagnostic'}</h2>
        <div className="flex items-center gap-3 mb-3">
          <span className={`w-4 h-4 rounded-full flex-shrink-0 ${uncertain ? 'bg-amber-400' : d.is_healthy ? 'bg-green-500' : 'bg-red-500'}`} />
          <p className="text-lg"><span className="font-semibold">{d.plant_species}</span> : {d.disease}</p>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3" role="img" aria-label={`Confiance ${pct(d.confidence)} %`}>
          <div className={`h-3 rounded-full ${uncertain ? 'bg-amber-400' : d.is_healthy ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${pct(d.confidence)}%` }} />
        </div>
        <p className="text-sm text-gray-500 mt-1">Confiance : {pct(d.confidence)} %</p>
      </div>

      {top.length > 1 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Les 3 hypothèses du modèle</h3>
          <ul className="space-y-2">
            {top.map((c) => (
              <li key={c.class_id} className="text-sm">
                <div className="flex justify-between gap-3">
                  <Link href={`/dashboard/guide?class=${encodeURIComponent(c.class_id)}`} className="text-phytora-dark hover:underline">{c.plant_species} : {c.disease}</Link>
                  <span className="text-gray-500 tabular-nums">{pct(c.score)} %</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-1.5 rounded-full bg-phytora-mid" style={{ width: `${pct(c.score)}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {heatmap && (
        <div>
          <div className="flex gap-2 mb-3" role="group" aria-label="Affichage de l’image">
            {[['photo', 'Ma photo'], ['heat', 'Zones analysées']].map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} aria-pressed={view === k}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${view === k ? 'bg-phytora-dark text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{label}</button>
            ))}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={view === 'heat' ? heatmap : preview} alt={view === 'heat' ? 'Carte de chaleur Grad-CAM' : 'Votre photo'} className="max-h-72 mx-auto rounded-lg object-contain" />
          {view === 'heat' && <p className="text-xs text-gray-500 mt-2 text-center">Les zones rouges ont le plus pesé dans la décision. Si elles tombent sur le fond et non sur la feuille, méfiez-vous du résultat.</p>}
        </div>
      )}

      <Link href={`/dashboard/guide?class=${encodeURIComponent(d.class_id)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-phytora-dark bg-phytora-light/15 hover:bg-phytora-light/25 px-4 py-2 rounded-lg transition">
        <BookOpen size={16} /> Voir la fiche : symptômes et prévention
      </Link>

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

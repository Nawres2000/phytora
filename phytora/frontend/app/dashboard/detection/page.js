'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, FlaskConical, ServerOff } from 'lucide-react';
import ImageDropzone from '@/components/ImageDropzone';
import WebcamCapture from '@/components/WebcamCapture';
import ExampleGallery from '@/components/ExampleGallery';
import Chat from '@/components/Chat';
import ClassificationResult from '@/components/ClassificationResult';
import { api } from '@/lib/api';
import { resizeToDataUrl } from '@/lib/image';

export default function Detection() {
  const [file, setFile] = useState(null);
  const [task, setTask] = useState('classification');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  useEffect(() => { api('/model/status').then(setStatus).catch(() => {}); }, []);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const reset = () => { setFile(null); setResult(null); setError(''); };
  const pick = (t) => () => { setTask(t); reset(); };

  async function analyze() {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      try { form.append('thumb', await resizeToDataUrl(file)); } catch {}
      setResult(await api(`/predict?task=${task}`, { method: 'POST', body: form }));
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  const tab = (t) => `px-6 py-2 rounded-full font-medium transition-all ${task === t ? 'bg-phytora-dark text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'}`;

  return (
    <div className="p-8 md:p-12 max-w-5xl mx-auto space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Nouvelle analyse</h1>
        <p className="text-gray-500">Importez une image pour lancer la détection par intelligence artificielle.</p>
      </header>

      <div className="flex flex-wrap gap-4">
        <button onClick={pick('classification')} className={tab('classification')} aria-pressed={task === 'classification'}>Diagnostiquer une feuille</button>
        <button onClick={pick('detection')} disabled={status && !status.detection} className={`${tab('detection')} disabled:opacity-50 disabled:cursor-not-allowed`} aria-pressed={task === 'detection'}>
          Détecter les mauvaises herbes{status && !status.detection && ' (bientôt)'}
        </button>
      </div>

      {status && !status.online && (
        <p role="alert" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-center gap-2"><ServerOff size={18} /> Le service du modèle est hors ligne : lancez FastAPI (model-api) pour analyser des images.</p>
      )}

      {!file ? (
        <div className="space-y-4">
          <ImageDropzone onImageSelected={setFile} />
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1"><WebcamCapture onImageSelected={setFile} /></div>
            <div className="flex-1">
              <p className="text-sm text-gray-500 mb-2 font-medium">Ou choisissez un exemple :</p>
              <ExampleGallery onImageSelected={setFile} />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow p-4 flex flex-col items-center relative">
          <button onClick={reset} aria-label="Retirer l’image" className="absolute top-2 right-2 bg-gray-200 hover:bg-gray-300 rounded-full w-8 h-8 flex items-center justify-center text-gray-600"><X size={16} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Image sélectionnée" className="max-h-80 rounded-lg object-contain" />
        </div>
      )}

      {file && !result && (
        <button onClick={analyze} disabled={loading} className="w-full py-4 rounded-xl bg-gradient-to-r from-phytora-dark to-phytora-light text-white font-bold text-lg shadow-lg hover:opacity-90 transition disabled:opacity-50">
          {loading ? 'Analyse en cours…' : 'Lancer l’analyse'}
        </button>
      )}
      {error && <p role="alert" className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100">{error}</p>}

      {result && result.task === 'classification' && <ClassificationResult key={result.scanId} result={result} preview={preview} />}

      {result && result.task === 'detection' && (
        <div className="bg-white rounded-2xl shadow-lg p-6 border-t-4 border-phytora-accent">
          {result.mock && (
            <p className="mb-4 p-3 rounded-xl bg-phytora-warn/15 text-amber-800 text-sm flex items-center gap-2">
              <FlaskConical size={16} /> Résultat de démonstration : ces chiffres sont aléatoires.
            </p>
          )}
          <h2 className="text-xl font-bold mb-4">Résultat de la détection</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-red-50 p-4 rounded-xl text-center"><p className="text-3xl font-bold text-red-500">{result.counts.weeds}</p><p className="text-sm text-gray-600">Mauvaises herbes</p></div>
            <div className="bg-teal-50 p-4 rounded-xl text-center"><p className="text-3xl font-bold text-teal-500">{result.counts.crops}</p><p className="text-sm text-gray-600">Cultures</p></div>
          </div>
          <p className="text-xs text-gray-400 font-mono text-right mt-4">Temps : {result.latency_ms} ms</p>
        </div>
      )}

      {result && <button onClick={reset} className="text-sm text-phytora-accent hover:underline">Analyser une autre image</button>}

      <Chat diagnosis={result} />
    </div>
  );
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, ServerOff, FlaskConical, Cpu } from 'lucide-react';
import ImageDropzone from '@/components/ImageDropzone';
import WebcamCapture from '@/components/WebcamCapture';
import LiveDiagnosis from '@/components/LiveDiagnosis';
import ExampleGallery from '@/components/ExampleGallery';
import ClassificationResult from '@/components/ClassificationResult';
import { api } from '@/lib/api';
import { resizeToDataUrl } from '@/lib/image';
import { useChat } from '@/context/ChatContext';

export default function Detection() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const chat = useChat();
  useEffect(() => { api('/model/status').then(setStatus).catch(() => {}); }, []);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const reset = () => { setFile(null); setResult(null); setError(''); };

  async function analyze() {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      try { form.append('thumb', await resizeToDataUrl(file)); } catch {}
      const t0 = performance.now();
      const r = await api('/predict', { method: 'POST', body: form });
      const out = { ...r, client_ms: Math.round(performance.now() - t0) }; // full round trip seen by the browser
      setResult(out);
      chat?.setScan(out); // the assistant now knows this diagnosis
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="p-6 md:p-12 max-w-5xl mx-auto space-y-6">
      <header className="mb-4">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Nouvelle analyse</h1>
        <p className="text-gray-500">Photographiez une feuille : le modèle identifie la plante et la maladie parmi 38 classes, estime la sévérité et montre où il a regardé.</p>
      </header>

      {status && !status.online && (
        <p role="alert" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-center gap-2"><ServerOff size={18} /> Le service du modèle est hors ligne : lancez FastAPI (backend) pour analyser des images.</p>
      )}
      {status?.online && (
        <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
          <Cpu size={14} /> Modèle <span className="font-mono">{status.model_version}</span> · moteur {status.engine}{status.variant && ` (${status.variant})`} · {status.gpu?.available ? `GPU ${status.gpu.name || ''}` : 'CPU'}
          {status.mock && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-phytora-warn/20 text-amber-800"><FlaskConical size={12} /> mode démonstration</span>}
        </p>
      )}

      {!file ? (
        <div className="space-y-4">
          <ImageDropzone onImageSelected={setFile} />
          <LiveDiagnosis onCapture={setFile} />
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
        <button onClick={analyze} disabled={loading || (status && !status.online)} className="w-full py-4 rounded-xl bg-gradient-to-r from-phytora-dark to-phytora-light text-white font-bold text-lg shadow-lg hover:opacity-90 transition disabled:opacity-50">
          {loading ? 'Analyse en cours…' : 'Lancer l’analyse'}
        </button>
      )}
      {error && <p role="alert" className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-100">{error}</p>}

      {result && <ClassificationResult key={result.scanId} result={result} file={file} preview={preview} onDiscuss={(q) => chat?.discuss(result, q)} />}
      {result && <button onClick={reset} className="text-sm text-phytora-accent hover:underline">Analyser une autre image</button>}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Video, Pause, Play, X, Camera, Gauge } from 'lucide-react';
import { API } from '@/lib/api';

const INTERVAL_MS = 700; // one frame every 0.7 s at most (one request in flight at a time)

/** Continuous webcam inference: frames go to /predict/live (fast path, nothing saved). */
export default function LiveDiagnosis({ onCapture }) {
  const cam = useRef(null), inFlight = useRef(false), timer = useRef(null), times = useRef([]);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(true);
  const [pred, setPred] = useState(null);
  const [stats, setStats] = useState({ client: null, server: null, fps: 0 });
  const [error, setError] = useState('');

  const tick = useCallback(async () => {
    if (inFlight.current || !cam.current) return;
    const shot = cam.current.getScreenshot({ width: 320, height: 240 });
    if (!shot) return;
    inFlight.current = true;
    const t0 = performance.now();
    try {
      const blob = await (await fetch(shot)).blob();
      const form = new FormData();
      form.append('file', new File([blob], 'frame.jpg', { type: 'image/jpeg' }));
      const res = await fetch(`${API}/predict/live`, { method: 'POST', body: form, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analyse impossible.');
      const client = performance.now() - t0;
      const now = performance.now();
      times.current = [...times.current.filter((t) => now - t < 5000), now];
      setPred(data);
      setStats({ client: Math.round(client), server: data.latency?.total_ms ?? data.latency_ms, inference: data.latency?.inference_ms, fps: (times.current.length / 5).toFixed(1) });
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!open || !running) return undefined;
    timer.current = setInterval(tick, INTERVAL_MS);
    return () => clearInterval(timer.current);
  }, [open, running, tick]);

  async function capture() {
    const shot = cam.current?.getScreenshot();
    if (!shot) return;
    const blob = await (await fetch(shot)).blob();
    setOpen(false);
    onCapture(new File([blob], 'webcam.jpg', { type: 'image/jpeg' }));
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setError(''); setPred(null); setRunning(true); setOpen(true); }}
        className="flex items-center justify-center gap-2 w-full py-3 bg-phytora-dark/90 hover:bg-phytora-dark text-white rounded-xl transition font-medium">
        <Video size={18} /> Diagnostic en direct (webcam)
      </button>
    );
  }

  const d = pred?.disease;
  const color = !d ? 'bg-gray-500/90' : pred.uncertain ? 'bg-amber-500/90' : d.is_healthy ? 'bg-green-600/90' : 'bg-red-600/90';
  return (
    <div className="rounded-2xl overflow-hidden bg-black text-white shadow-lg">
      <div className="relative">
        <Webcam ref={cam} audio={false} screenshotFormat="image/jpeg" screenshotQuality={0.8} videoConstraints={{ facingMode: 'environment' }}
          onUserMediaError={() => { setError('Impossible d’accéder à la caméra. Vérifiez les autorisations du navigateur.'); setRunning(false); }}
          className="w-full max-h-[420px] object-contain bg-black" />
        {/* overlay drawn over the video stream */}
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-3 pointer-events-none">
          {d && (
            <div className={`px-3 py-2 rounded-xl ${color} backdrop-blur-sm shadow`}>
              <p className="text-xs uppercase tracking-wide opacity-80">{pred.uncertain ? 'Incertain' : d.is_healthy ? 'Saine' : 'Maladie probable'}</p>
              <p className="font-bold leading-tight">{d.plant_species} · {d.disease}</p>
              <p className="text-sm tabular-nums">{Math.round(d.confidence * 100)} %</p>
            </div>
          )}
          <div className="ml-auto px-2.5 py-1.5 rounded-lg bg-black/60 text-[11px] font-mono leading-5 text-right">
            <p className="flex items-center gap-1 justify-end"><Gauge size={12} /> {stats.fps} img/s</p>
            <p>client {stats.client ?? '–'} ms</p>
            <p>serveur {stats.server ?? '–'} ms</p>
            <p>modèle {stats.inference ?? '–'} ms</p>
          </div>
        </div>
        {running && <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs bg-red-600 px-2 py-0.5 rounded-full"><span className="w-2 h-2 rounded-full bg-white animate-pulse" /> EN DIRECT</span>}
      </div>
      {pred?.top_k && (
        <ul className="px-4 pt-3 space-y-1.5">
          {pred.top_k.map((c) => (
            <li key={c.class_id} className="text-xs">
              <div className="flex justify-between"><span className="truncate">{c.plant_species} · {c.disease}</span><span className="tabular-nums">{Math.round(c.score * 100)} %</span></div>
              <div className="h-1.5 bg-white/15 rounded-full"><div className="h-1.5 rounded-full bg-phytora-light transition-[width] duration-500" style={{ width: `${Math.round(c.score * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="px-4 pt-3 text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2 p-4">
        <button type="button" onClick={() => setRunning((r) => !r)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm">
          {running ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Reprendre</>}
        </button>
        <button type="button" onClick={capture} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-phytora-light text-phytora-dark font-semibold text-sm hover:opacity-90">
          <Camera size={15} /> Capturer et analyser en détail
        </button>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"><X size={15} /> Fermer</button>
      </div>
    </div>
  );
}

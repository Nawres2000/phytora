'use client';
import { useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { Camera } from 'lucide-react';

export default function WebcamCapture({ onImageSelected }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const capture = async () => {
    const src = ref.current?.getScreenshot();
    if (!src) return;
    const blob = await (await fetch(src)).blob();
    onImageSelected(new File([blob], 'webcam.jpg', { type: 'image/jpeg' }));
    setOpen(false);
  };

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => { setError(''); setOpen(true); }}
          className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-xl transition font-medium text-gray-700">
          <Camera size={18} /> Utiliser la webcam
        </button>
        {error && <p role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 p-4 bg-black rounded-xl">
      <Webcam audio={false} ref={ref} screenshotFormat="image/jpeg" videoConstraints={{ facingMode: 'environment' }}
        onUserMediaError={() => { setError('Impossible d’accéder à la caméra. Vérifiez les autorisations du navigateur.'); setOpen(false); }}
        className="rounded-lg max-h-64 w-auto" />
      <div className="flex gap-2">
        <button type="button" onClick={capture} className="px-4 py-2 bg-phytora-light text-phytora-dark rounded-lg font-semibold hover:opacity-90">Capturer</button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 bg-gray-600 text-white rounded-lg font-medium hover:opacity-90">Annuler</button>
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import Webcam from "react-webcam";

export default function WebcamCapture({ onImageSelected }) {
  const webcamRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  const capture = () => {
    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      // Convertir l'image base64 en fichier
      fetch(imageSrc)
        .then((res) => res.blob())
        .then((blob) => {
          const file = new File([blob], "webcam.jpg", { type: "image/jpeg" });
          onImageSelected(file);
          setIsOpen(false);
        });
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-xl transition font-medium text-gray-700"
      >
        📷 Utiliser la webcam
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 p-4 bg-black rounded-xl">
      <Webcam
        audio={false}
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        className="rounded-lg max-h-64 w-auto"
      />
      <div className="flex gap-2">
        <button
          onClick={capture}
          className="px-4 py-2 bg-phytora-light text-white rounded-lg font-medium hover:opacity-90"
        >
          📸 Capturer
        </button>
        <button
          onClick={() => setIsOpen(false)}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg font-medium hover:opacity-90"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
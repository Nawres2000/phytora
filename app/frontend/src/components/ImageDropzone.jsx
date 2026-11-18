import { useState } from "react";
import { useDropzone } from "react-dropzone";

export default function ImageDropzone({ onImageSelected }) {
  const [preview, setPreview] = useState(null);

  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    onImageSelected(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    maxFiles: 1,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all
        ${isDragActive ? "border-phytora-light bg-phytora-light/10" : "border-gray-300 hover:border-phytora-mid bg-white"}`}
    >
      <input {...getInputProps()} />
      {preview ? (
        <img src={preview} alt="Aperçu" className="max-h-72 mx-auto rounded-lg shadow-sm object-contain" />
      ) : (
        <div className="py-8">
          <p className="text-lg font-medium text-gray-700">Glissez une image ici</p>
          <p className="text-sm text-gray-500 mt-1">ou cliquez pour choisir un fichier (JPEG/PNG/WebP)</p>
        </div>
      )}
    </div>
  );
}
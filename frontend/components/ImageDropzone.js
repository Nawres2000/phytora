'use client';
import { useDropzone } from 'react-dropzone';
import { ImagePlus } from 'lucide-react';

export default function ImageDropzone({ onImageSelected }) {
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop: (files) => files[0] && onImageSelected(files[0]),
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [] },
    maxFiles: 1,
    maxSize: 8 * 1024 * 1024,
  });
  return (
    <div>
      <div {...getRootProps()} className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${isDragActive ? 'border-phytora-light bg-phytora-light/10' : 'border-gray-300 hover:border-phytora-mid bg-white'}`}>
        <input {...getInputProps()} aria-label="Choisir une image" />
        <div className="py-6">
          <ImagePlus className="mx-auto text-phytora-mid mb-3" size={36} />
          <p className="text-lg font-medium text-gray-700">Glissez une image ici</p>
          <p className="text-sm text-gray-500 mt-1">ou cliquez pour choisir un fichier (JPEG, PNG ou WebP, 8 Mo max)</p>
        </div>
      </div>
      {fileRejections.length > 0 && <p role="alert" className="text-sm text-red-600 mt-2">Fichier refusé : utilisez une image JPEG, PNG ou WebP de moins de 8 Mo.</p>}
    </div>
  );
}

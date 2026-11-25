'use client';

const EXAMPLES = [
  { src: '/examples/feuille.jpg', label: 'Feuille' },
  { src: '/examples/champ.jpg', label: 'Champ' },
];

export default function ExampleGallery({ onImageSelected }) {
  const select = async (src) => {
    const blob = await (await fetch(src)).blob();
    onImageSelected(new File([blob], src.split('/').pop(), { type: blob.type }));
  };
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {EXAMPLES.map(({ src, label }) => (
        <button key={src} type="button" onClick={() => select(src)} title={`Exemple : ${label}`}
          className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-transparent hover:border-phytora-light transition">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={label} className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );
}

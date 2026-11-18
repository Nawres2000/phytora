export default function ExampleGallery({ onImageSelected }) {
  const handleSelect = async (src) => {
    // Charger l'image depuis le dossier public et la transformer en Fichier
    const response = await fetch(src);
    const blob = await response.blob();
    const file = new File([blob], "example.jpg", { type: blob.type });
    onImageSelected(file);
  };

  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      <button
        onClick={() => handleSelect("/examples/feuille.jpg")}
        className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-transparent hover:border-phytora-light transition"
      >
        <img src="/examples/feuille.jpg" alt="Feuille" className="w-full h-full object-cover" />
      </button>
      <button
        onClick={() => handleSelect("/examples/champ.jpg")}
        className="flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-transparent hover:border-phytora-light transition"
      >
        <img src="/examples/champ.jpg" alt="Champ" className="w-full h-full object-cover" />
      </button>
    </div>
  );
}
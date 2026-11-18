import { useState } from "react";
import ImageDropzone from "../components/ImageDropzone";
import WebcamCapture from "../components/WebcamCapture";
import ExampleGallery from "../components/ExampleGallery";
import { predict } from "../services/api";

export default function Detection() {
  const [file, setFile] = useState(null);
  const [task, setTask] = useState("classification");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await predict(file, task);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Erreur lors de l'analyse.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 md:p-12 max-w-5xl mx-auto space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Nouvelle Analyse</h1>
        <p className="text-gray-500">Importez une image pour lancer la détection par intelligence artificielle.</p>
      </header>

      {/* Choix de la tâche */}
      <div className="flex gap-4">
        <button
          onClick={() => { setTask("classification"); setFile(null); setResult(null); }}
          className={`px-6 py-2 rounded-full font-medium transition-all ${
            task === "classification" ? "bg-phytora-dark text-white shadow-md" : "bg-white text-gray-600 hover:bg-gray-100 shadow-sm"
          }`}
        >
          Diagnostiquer une feuille
        </button>
        <button
          onClick={() => { setTask("detection"); setFile(null); setResult(null); }}
          className={`px-6 py-2 rounded-full font-medium transition-all ${
            task === "detection" ? "bg-phytora-dark text-white shadow-md" : "bg-white text-gray-600 hover:bg-gray-100 shadow-sm"
          }`}
        >
          Détecter les mauvaises herbes
        </button>
      </div>

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
          <button onClick={() => setFile(null)} className="absolute top-2 right-2 bg-gray-200 hover:bg-gray-300 rounded-full w-8 h-8 flex items-center justify-center text-gray-600 font-bold">×</button>
          <img src={URL.createObjectURL(file)} alt="Sélection" className="max-h-80 rounded-lg object-contain" />
        </div>
      )}

      {file && (
        <button onClick={handleAnalyze} disabled={loading} className="w-full py-4 rounded-xl bg-gradient-to-r from-phytora-dark to-phytora-light text-white font-bold text-lg shadow-lg hover:opacity-90 transition disabled:opacity-50">
          {loading ? "Analyse en cours..." : "Lancer l'analyse"}
        </button>
      )}

      {error && <p className="text-red-500 font-medium">{error}</p>}

      {result && (
        <div className="bg-white rounded-2xl shadow-lg p-6 border-t-4 border-phytora-accent">
            {result.task === "classification" ? (
              <div>
                <h3 className="text-xl font-bold mb-4">Résultat du diagnostic</h3>
                <div className="flex items-center gap-3 mb-4">
                  <span className={`w-4 h-4 rounded-full ${result.disease.is_healthy ? "bg-green-500" : "bg-red-500"}`}></span>
                  <p className="text-lg"><span className="font-semibold">{result.disease.plant_species}</span> : {result.disease.disease}</p>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div className={`h-3 rounded-full ${result.disease.is_healthy ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${result.disease.confidence * 100}%` }}></div>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-xl font-bold mb-4">Résultat de la détection</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-red-50 p-4 rounded-xl text-center">
                    <p className="text-3xl font-bold text-red-500">{result.counts.weeds}</p>
                    <p className="text-sm text-gray-600">Mauvaises herbes</p>
                  </div>
                  <div className="bg-teal-50 p-4 rounded-xl text-center">
                    <p className="text-3xl font-bold text-teal-500">{result.counts.crops}</p>
                    <p className="text-sm text-gray-600">Cultures</p>
                  </div>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-4 text-right font-mono">Temps : {result.latency_ms} ms</p>
        </div>
      )}
    </div>
  );
}
import { useState } from "react";
import { diseasesData } from "../data/diseases";
import { Search, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, ShieldCheck, ExternalLink } from "lucide-react";

export default function Guide() {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  // Filtrer les maladies selon la recherche (par plante ou par maladie)
  const filteredDiseases = diseasesData.filter((item) => 
    item.plant.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.disease.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="p-8 md:p-12 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Guide des Maladies</h1>
        <p className="text-gray-500">Consultez les symptômes et les conseils de prévention.</p>
      </header>

      {/* Barre de recherche */}
      <div className="relative mb-8">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search size={20} className="text-gray-400" />
        </div>
        <input
          type="text"
          placeholder="Rechercher une plante ou une maladie (ex: Tomate, Mildiou)..."
          className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-phytora-light outline-none transition-shadow shadow-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Liste des maladies */}
      <div className="space-y-4">
        {filteredDiseases.length === 0 ? (
          <p className="text-center text-gray-500 py-10">Aucun résultat trouvé pour "{searchTerm}".</p>
        ) : (
          filteredDiseases.map((item) => (
            <div 
              key={item.id} 
              className={`bg-white border rounded-2xl overflow-hidden transition-all duration-300 ${
                expandedId === item.id ? "border-phytora-light shadow-md" : "border-gray-100 shadow-sm hover:border-gray-300"
              }`}
            >
              {/* Entête de la carte (cliquable) */}
              <button 
                onClick={() => toggleExpand(item.id)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${item.isHealthy ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-500"}`}>
                    {item.isHealthy ? <CheckCircle size={24} /> : <AlertTriangle size={24} />}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">{item.plant}</h3>
                    <p className={`text-sm font-medium ${item.isHealthy ? "text-green-600" : "text-orange-500"}`}>
                      {item.disease}
                    </p>
                  </div>
                </div>
                {expandedId === item.id ? (
                  <ChevronUp className="text-gray-400" />
                ) : (
                  <ChevronDown className="text-gray-400" />
                )}
              </button>

              {/* Contenu dépliable (Symptômes, Prévention & Liens) */}
              {expandedId === item.id && (
                <div className="px-5 pb-5 pt-2 border-t border-gray-50 text-sm text-gray-600 space-y-4">
                  
                  {/* Symptômes */}
                  <div>
                    <strong className="block text-gray-800 mb-1">Symptômes :</strong>
                    <p>{item.symptoms}</p>
                  </div>

                  {/* Prévention */}
                  <div className="bg-gray-50 p-4 rounded-xl flex gap-3">
                    <ShieldCheck className="text-phytora-dark flex-shrink-0" size={20} />
                    <div>
                      <strong className="block text-gray-800 mb-1">Prévention & Recommandations :</strong>
                      <p>{item.prevention}</p>
                    </div>
                  </div>

                  {/* Liens externes */}
                  {item.links && item.links.length > 0 && (
                    <div className="pt-2">
                      <strong className="block text-gray-800 mb-2">En savoir plus :</strong>
                      <div className="flex flex-wrap gap-2">
                        {item.links.map((link, index) => (
                          <a
                            key={index}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-phytora-light/10 text-phytora-dark font-medium rounded-lg hover:bg-phytora-light/20 transition-colors text-xs"
                          >
                            {link.title}
                            <ExternalLink size={12} />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
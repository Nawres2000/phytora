'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, ChevronUp, TriangleAlert, CheckCircle, ShieldCheck, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function Guide() {
  const [items, setItems] = useState(null), [error, setError] = useState('');
  const [q, setQ] = useState(''), [showHealthy, setShowHealthy] = useState(false), [open, setOpen] = useState(null);
  const refs = useRef({}), deepLink = useRef(null);

  useEffect(() => {
    api('/catalog').then((d) => {
      const list = [...d.classes].sort((a, b) => a.plant.localeCompare(b.plant, 'fr') || a.disease.localeCompare(b.disease, 'fr'));
      const id = new URLSearchParams(window.location.search).get('class');
      const target = list.find((c) => c.id === id);
      if (target) { deepLink.current = target.id; setShowHealthy(target.healthy); setOpen(target.id); }
      setItems(list);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (items && deepLink.current) { refs.current[deepLink.current]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); deepLink.current = null; }
  }, [items]);

  const shown = useMemo(() => (items || []).filter((c) =>
    (showHealthy || !c.healthy || c.id === open) && (norm(c.plant).includes(norm(q)) || norm(c.disease).includes(norm(q)))), [items, q, showHealthy, open]);

  return (
    <div className="p-8 md:p-12 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Guide des maladies</h1>
        <p className="text-gray-500">Symptômes et conseils de prévention pour les {items?.filter((c) => !c.healthy).length ?? 26} maladies reconnues par le modèle.</p>
        <p className="text-xs text-gray-400 mt-2">Informations générales et non exhaustives, sans dosage de produits. Pour un traitement, demandez conseil à un agronome ou à votre service phytosanitaire.</p>
      </header>

      <div className="relative mb-4">
        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une plante ou une maladie" placeholder="Rechercher une plante ou une maladie (ex : Tomate, Mildiou)…"
          className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-phytora-light outline-none shadow-sm" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600 mb-8">
        <input type="checkbox" checked={showHealthy} onChange={(e) => setShowHealthy(e.target.checked)} /> Afficher aussi les plantes saines
      </label>

      {error && <p role="alert" className="text-red-600">{error}</p>}
      {!items && !error && <p className="text-gray-500">Chargement…</p>}
      <div className="space-y-4">
        {items && shown.length === 0 && <p className="text-center text-gray-500 py-10">Aucun résultat pour « {q} ».</p>}
        {shown.map((c) => {
          const expanded = open === c.id;
          return (
            <div key={c.id} ref={(el) => { refs.current[c.id] = el; }}
              className={`bg-white border rounded-2xl overflow-hidden transition-all duration-300 ${expanded ? 'border-phytora-light shadow-md' : 'border-gray-100 shadow-sm hover:border-gray-300'}`}>
              <button onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded} className="w-full flex items-center justify-between p-5 text-left">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${c.healthy ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-500'}`}>{c.healthy ? <CheckCircle size={24} /> : <TriangleAlert size={24} />}</div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">{c.plant}</h2>
                    <p className={`text-sm font-medium ${c.healthy ? 'text-green-600' : 'text-orange-500'}`}>{c.disease}</p>
                  </div>
                </div>
                {expanded ? <ChevronUp className="text-gray-400" /> : <ChevronDown className="text-gray-400" />}
              </button>
              {expanded && (
                <div className="px-5 pb-5 pt-2 border-t border-gray-50 text-sm text-gray-600 space-y-4">
                  <div><strong className="block text-gray-800 mb-1">Symptômes :</strong><p>{c.symptoms}</p></div>
                  <div className="bg-gray-50 p-4 rounded-xl flex gap-3">
                    <ShieldCheck className="text-phytora-dark flex-shrink-0" size={20} />
                    <div><strong className="block text-gray-800 mb-1">Prévention &amp; recommandations :</strong><p>{c.prevention}</p></div>
                  </div>
                  {c.links?.length > 0 && (
                    <div>
                      <strong className="block text-gray-800 mb-2">En savoir plus :</strong>
                      <div className="flex flex-wrap gap-2">
                        {c.links.map((l) => (
                          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-phytora-light/10 text-phytora-dark font-medium rounded-lg hover:bg-phytora-light/20 transition-colors text-xs">
                            {l.title} <ExternalLink size={12} />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

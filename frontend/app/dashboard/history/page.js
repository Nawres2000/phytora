'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Download } from 'lucide-react';
import ScanRow from '@/components/ScanRow';

export default function HistoryPage() {
  const [scans, setScans] = useState(null), [error, setError] = useState('');
  useEffect(() => { api('/scans').then((d) => setScans(d.scans)).catch((e) => setError(e.message)); }, []);

  async function remove(scan) {
    if (!confirm('Supprimer cette analyse ?')) return;
    try { await api(`/scans/${scan._id}`, { method: 'DELETE' }); setScans((s) => s.filter((x) => x._id !== scan._id)); }
    catch (e) { setError(e.message); }
  }

  function exportCsv() {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Date', 'Plante', 'Diagnostic', 'Confiance (%)', 'Sévérité (%)', 'Niveau', 'Incertain', 'Retour', 'Latence (ms)', 'Modèle'];
    const rows = scans.map((s) => [
      new Date(s.createdAt).toLocaleString('fr-FR'), s.plant, s.disease,
      s.confidence != null ? Math.round(s.confidence * 100) : '', s.severity?.percent ?? '', s.severity?.level ?? '', s.uncertain ? 'oui' : 'non',
      s.feedback?.correct === true ? 'confirmé' : s.feedback?.correct === false ? 'corrigé' : '', s.latencyMs != null ? Math.round(s.latencyMs) : '', s.modelVersion,
    ]);
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n'); // BOM + ; so Excel opens it correctly in French
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'phytora-historique.csv' });
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="p-8 md:p-12 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Historique des analyses</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-gray-500">Vos 100 dernières analyses.</p>
          {scans?.length > 0 && <button onClick={exportCsv} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-100"><Download size={16} /> Exporter en CSV</button>}
        </div>
      </header>
      {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}
      {scans === null ? <p className="text-gray-500">Chargement…</p>
        : scans.length === 0 ? <p className="text-center text-gray-500 py-16 bg-white rounded-2xl border border-gray-100">Aucune analyse pour le moment.</p>
        : <ul className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">{scans.map((s) => <ScanRow key={s._id} scan={s} onDelete={remove} />)}</ul>}
    </div>
  );
}

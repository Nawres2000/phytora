'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScanLine, CheckCircle, AlertTriangle, Calendar } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import ScanRow from '@/components/ScanRow';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null), [error, setError] = useState('');
  useEffect(() => { api('/scans/stats').then(setStats).catch((e) => setError(e.message)); }, []);

  const cards = [
    { label: 'Analyses totales', value: stats?.total, icon: <ScanLine className="text-phytora-dark" />, bg: 'bg-phytora-light/10' },
    { label: 'Plantes saines', value: stats?.healthy, icon: <CheckCircle className="text-green-500" />, bg: 'bg-green-50' },
    { label: 'Maladies détectées', value: stats?.diseased, icon: <AlertTriangle className="text-orange-500" />, bg: 'bg-orange-50' },
    { label: 'Analyses des 7 derniers jours', value: stats?.last7, icon: <Calendar className="text-blue-500" />, bg: 'bg-blue-50' },
  ];

  return (
    <div className="p-8 md:p-12">
      <header className="mb-10">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Bonjour, {user.name} ! 👋</h1>
        <p className="text-gray-500">Voici ce qui se passe dans vos cultures aujourd’hui.</p>
      </header>
      {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((c) => (
          <div key={c.label} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${c.bg}`}>{c.icon}</div>
            <div>
              <p className="text-4xl font-bold text-gray-800 mb-1">{c.value ?? '–'}</p>
              <p className="text-sm font-medium text-gray-500">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 bg-gradient-to-r from-phytora-dark to-phytora-mid rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Prêt à analyser une nouvelle image ?</h2>
          <p className="text-white/80">Utilisez notre outil d’IA pour détecter les maladies ou les mauvaises herbes.</p>
        </div>
        <Link href="/dashboard/detection" className="mt-6 md:mt-0 px-6 py-3 bg-white text-phytora-dark font-bold rounded-xl hover:bg-gray-100 transition shadow-lg">Lancer une analyse</Link>
      </div>

      {stats?.recent?.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-800">Analyses récentes</h2>
            <Link href="/dashboard/history" className="text-sm text-phytora-accent hover:underline">Tout voir</Link>
          </div>
          <ul className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
            {stats.recent.map((s) => <ScanRow key={s._id} scan={s} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

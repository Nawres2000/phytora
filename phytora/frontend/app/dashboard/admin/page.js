'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

const STATS = [['total', 'Utilisateurs'], ['verified', 'E-mails confirmés'], ['newThisWeek', 'Nouveaux (7 j)'], ['admins', 'Admins'], ['disabled', 'Désactivés']];
const Tag = ({ children, tone = 'bg-gray-100 text-gray-600' }) => <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${tone}`}>{children}</span>;

export default function Admin() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState(null), [users, setUsers] = useState([]);
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [pages, setPages] = useState(1), [err, setErr] = useState('');
  const isAdmin = user.role === 'admin';

  useEffect(() => { if (!isAdmin) router.replace('/dashboard'); }, [isAdmin, router]);

  const load = useCallback(async (p, query) => {
    try {
      const [s, u] = await Promise.all([api('/admin/stats'), api(`/admin/users?q=${encodeURIComponent(query)}&page=${p}`)]);
      setStats(s); setUsers(u.users); setPages(u.pages); setErr('');
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { if (isAdmin) load(page, q); }, [isAdmin, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => { try { await fn(); await load(page, q); } catch (e) { setErr(e.message); } };
  const patch = (u, body) => act(() => api(`/admin/users/${u._id}`, { method: 'PATCH', json: body }));
  const remove = (u) => confirm(`Supprimer ${u.email} ? Cette action est irréversible.`) && act(() => api(`/admin/users/${u._id}`, { method: 'DELETE' }));

  if (!isAdmin) return null;
  const btn = 'px-3 py-1 rounded-lg text-xs font-semibold border transition';
  return (
    <div className="p-8 md:p-12 max-w-6xl mx-auto">
      <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Administration</h1>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {STATS.map(([k, label]) => (
          <div key={k} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-3xl font-extrabold text-gray-800">{stats ? stats[k] : '–'}</p>
            <p className="text-sm text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            [stats.scans, 'Analyses réalisées'],
            [stats.scans ? `${Math.round((100 * stats.uncertain) / stats.scans)} %` : '–', 'Jugées incertaines'],
            [stats.feedbackTotal, 'Retours utilisateurs'],
            [stats.feedbackTotal ? `${Math.round((100 * stats.feedbackCorrect) / stats.feedbackTotal)} %` : '–', 'Diagnostics confirmés'],
          ].map(([v, label]) => (
            <div key={label} className="bg-white rounded-2xl border border-phytora-light/40 shadow-sm p-5">
              <p className="text-3xl font-extrabold text-phytora-dark">{v}</p>
              <p className="text-sm text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      )}

      <form className="flex gap-3 mb-4" onSubmit={(e) => { e.preventDefault(); setPage(1); load(1, q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom ou e-mail" aria-label="Rechercher un utilisateur" className="input-phytora" />
        <button className="px-6 rounded-xl bg-phytora-dark text-white font-semibold hover:bg-phytora-mid transition">Rechercher</button>
      </form>
      {err && <p role="alert" className="p-3 rounded-xl bg-red-50 text-red-700 text-sm mb-4">{err}</p>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left text-gray-500 border-b border-gray-100">
            {['Utilisateur', 'Rôle', 'Statut', 'Inscrit le', 'Actions'].map((h) => <th key={h} className="p-4 font-semibold">{h}</th>)}
          </tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u._id === user.id;
              return (
                <tr key={u._id} className="border-b border-gray-50 last:border-0">
                  <td className="p-4"><p className="font-semibold text-gray-800">{u.name}</p><p className="text-gray-500">{u.email}</p></td>
                  <td className="p-4"><Tag tone={u.role === 'admin' ? 'bg-phytora-light/20 text-phytora-dark' : undefined}>{u.role === 'admin' ? 'Admin' : 'Utilisateur'}</Tag></td>
                  <td className="p-4">{u.disabled ? <Tag tone="bg-red-50 text-red-700">Désactivé</Tag> : u.emailVerified ? <Tag tone="bg-green-50 text-green-700">Confirmé</Tag> : <Tag>Non confirmé</Tag>}</td>
                  <td className="p-4 text-gray-500">{new Date(u.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td className="p-4">{self ? <span className="text-gray-400">Vous</span> : (
                    <div className="flex flex-wrap gap-2">
                      <button className={`${btn} border-gray-300 hover:bg-gray-100`} onClick={() => patch(u, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? 'Retirer admin' : 'Rendre admin'}</button>
                      <button className={`${btn} border-gray-300 hover:bg-gray-100`} onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? 'Réactiver' : 'Désactiver'}</button>
                      <button className={`${btn} border-red-200 text-red-600 hover:bg-red-50`} onClick={() => remove(u)}>Supprimer</button>
                    </div>)}</td>
                </tr>
              );
            })}
            {!users.length && <tr><td colSpan={5} className="p-8 text-center text-gray-500">Aucun utilisateur trouvé.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-center gap-4 mt-6 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-4 py-2 rounded-lg border border-gray-300 disabled:opacity-40">Précédent</button>
        <span className="text-gray-500">Page {page} sur {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-4 py-2 rounded-lg border border-gray-300 disabled:opacity-40">Suivant</button>
      </div>
    </div>
  );
}

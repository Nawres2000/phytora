'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, LayoutDashboard, ScanLine, History, Leaf, BookOpen, Menu, X, User, Settings, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Logo from '@/components/Logo';

const NAV = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/dashboard/detection', label: 'Détection IA', icon: ScanLine },
  { href: '/dashboard/history', label: 'Historique', icon: History },
  { href: '/dashboard/crops', label: 'Mes cultures', icon: Leaf },
  { href: '/dashboard/guide', label: 'Guide des maladies', icon: BookOpen },
  { href: '/dashboard/profile', label: 'Profil & paramètres', icon: User },
];

export default function DashboardLayout({ children }) {
  const { user, ready, logout } = useAuth();
  const router = useRouter(), pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { if (ready && !user) router.replace('/signin'); }, [ready, user, router]);
  useEffect(() => { setOpen(window.innerWidth >= 768); }, []);

  if (!ready || !user) return <p className="min-h-screen grid place-items-center text-gray-500">Chargement…</p>;

  const items = user.role === 'admin' ? [...NAV, { href: '/dashboard/admin', label: 'Administration', icon: ShieldCheck }] : NAV;
  const isActive = (href) => (href === '/dashboard' ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-hidden">
      {open && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed md:relative top-0 left-0 h-screen z-50 bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out ${open ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0 md:w-0 md:opacity-0 md:overflow-hidden'}`}>
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <Logo size={28} />
          <button onClick={() => setOpen(false)} aria-label="Fermer le menu" className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-2">Menu principal</div>
          <nav className="space-y-1">
            {items.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => window.innerWidth < 768 && setOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive(href) ? 'bg-phytora-light/15 text-phytora-dark font-semibold' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}>
                <Icon size={20} /> {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center justify-between px-2 mb-4">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-full bg-phytora-dark flex-shrink-0 flex items-center justify-center text-white font-bold overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : user.name.charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-bold text-gray-800 truncate">{user.name}</p>
                <p className="text-xs text-gray-500">{user.role === 'admin' ? 'Administrateur' : 'Agriculteur'}</p>
              </div>
            </div>
            <Link href="/dashboard/profile" title="Paramètres du profil" aria-label="Paramètres du profil" className="p-2 text-gray-400 hover:text-phytora-dark hover:bg-gray-100 rounded-lg transition-colors"><Settings size={18} /></Link>
          </div>
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition font-medium">
            <LogOut size={16} /> Déconnexion
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="bg-white p-4 border-b border-gray-200 flex items-center justify-between z-30">
          <div className="flex items-center gap-4">
            <button onClick={() => setOpen(!open)} title={open ? 'Cacher le menu' : 'Afficher le menu'} aria-label={open ? 'Cacher le menu' : 'Afficher le menu'} className="p-2 bg-gray-50 hover:bg-gray-200 rounded-lg text-gray-700 transition"><Menu size={24} /></button>
            <h2 className="font-semibold text-gray-700 hidden sm:block">Espace de travail</h2>
          </div>
          <div className="text-sm text-gray-500">Connecté : {user.name}</div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}

'use client';
import { useRef, useState } from 'react';
import { Camera, CheckCircle2, AlertCircle, Mail, Lock, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { passwordOk } from '@/lib/password';
import { resizeToDataUrl } from '@/lib/image';
import PasswordInput from '@/components/PasswordInput';
import PasswordRules from '@/components/PasswordRules';

const Label = ({ icon: Icon, children }) => (
  <span className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">{Icon && <Icon size={16} className="text-phytora-dark" />}{children}</span>
);
const Card = ({ title, children, ...props }) => (
  <form {...props} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-5">
    <h2 className="text-lg font-bold text-gray-800 border-b pb-2">{title}</h2>{children}
  </form>
);

function Msg({ k, note }) {
  if (note.key !== k || !note.text) return null;
  return (
    <p role={note.type === 'err' ? 'alert' : 'status'} className={`p-3 rounded-xl text-sm flex items-center gap-2 border ${note.type === 'err' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-200'}`}>
      {note.type === 'err' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}{note.text}
    </p>
  );
}

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const fileRef = useRef(null);
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState(user.avatar || null);
  const [em, setEm] = useState({ email: '', password: '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [del, setDel] = useState('');
  const [note, setNote] = useState({});

  const run = (key, fn) => async (e) => {
    e.preventDefault(); setNote({});
    try { setNote({ key, type: 'ok', text: await fn() }); } catch (x) { setNote({ key, type: 'err', text: x.message }); }
  };

  async function onAvatar(e) {
    const f = e.target.files[0];
    if (!f) return;
    try { setAvatar(await resizeToDataUrl(f, 256, 0.8)); } catch { setNote({ key: 'profile', type: 'err', text: 'Image illisible.' }); }
  }

  return (
    <div className="p-8 md:p-12 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Profil &amp; paramètres</h1>
        <p className="text-gray-500">Gérez vos informations personnelles et votre compte.</p>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <form onSubmit={run('profile', async () => {
          const d = await api('/account/profile', { method: 'PATCH', json: { name, ...(avatar !== (user.avatar || null) && { avatar }) } });
          setUser(d.user); return 'Profil mis à jour avec succès !';
        })}>
          <div className="h-32 bg-gradient-to-r from-phytora-dark to-phytora-light" />
          <div className="px-8 pb-8">
            <div className="relative flex justify-between items-end -mt-12 mb-8">
              <div className="relative group">
                <div className="w-24 h-24 rounded-full border-4 border-white bg-gray-200 overflow-hidden shadow-md flex items-center justify-center text-gray-400 text-3xl font-bold">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {avatar ? <img src={avatar} alt="Votre avatar" className="w-full h-full object-cover" /> : user.name.charAt(0).toUpperCase()}
                </div>
                <button type="button" onClick={() => fileRef.current.click()} title="Changer la photo" aria-label="Changer la photo"
                  className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer text-white"><Camera size={24} /></button>
                <input type="file" accept="image/jpeg,image/png,image/webp" ref={fileRef} onChange={onAvatar} className="hidden" />
              </div>
              <span className="text-sm text-gray-500 pb-2">Membre depuis {new Date(user.createdAt).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</span>
            </div>
            <div className="space-y-5 max-w-md">
              <label className="block"><Label icon={UserIcon}>Nom d’utilisateur</Label>
                <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} className="input-phytora" /></label>
              <Msg k="profile" note={note} />
              <button className="px-8 py-2.5 rounded-xl font-bold shadow-lg transition bg-phytora-dark text-white hover:bg-phytora-mid disabled:opacity-50"
                disabled={name.trim() === user.name && avatar === (user.avatar || null)}>Enregistrer les modifications</button>
            </div>
          </div>
        </form>
      </div>

      <Card title="Adresse e-mail" onSubmit={run('email', async () => {
        const d = await api('/account/email', { method: 'POST', json: em }); setUser(d.user); setEm({ email: '', password: '' }); return d.message;
      })}>
        <p className="text-sm text-gray-500">Adresse actuelle : <strong>{user.email}</strong></p>
        {user.pendingEmail && <p className="p-3 rounded-xl bg-phytora-warn/15 text-amber-800 text-sm">En attente de confirmation : {user.pendingEmail}. Consultez cette boîte mail.</p>}
        <div className="grid md:grid-cols-2 gap-5">
          <label className="block"><Label icon={Mail}>Nouvelle adresse</Label>
            <input type="email" required value={em.email} onChange={(e) => setEm({ ...em, email: e.target.value })} autoComplete="email" className="input-phytora" /></label>
          <div><Label icon={Lock}>Mot de passe actuel</Label>
            <PasswordInput value={em.password} onChange={(e) => setEm({ ...em, password: e.target.value })} autoComplete="current-password" /></div>
        </div>
        <Msg k="email" note={note} />
        <button className="px-6 py-2.5 rounded-xl font-bold bg-phytora-dark text-white hover:bg-phytora-mid transition">Changer l’e-mail</button>
      </Card>

      <Card title="Sécurité" onSubmit={run('pw', async () => {
        const d = await api('/account/password', { method: 'POST', json: pw }); setPw({ current: '', password: '' }); return d.message;
      })}>
        <div className="grid md:grid-cols-2 gap-5">
          <div><Label icon={Lock}>Mot de passe actuel</Label>
            <PasswordInput value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></div>
          <div><Label icon={Lock}>Nouveau mot de passe</Label>
            <PasswordInput value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} autoComplete="new-password" placeholder="Créez un mot de passe fort" /></div>
        </div>
        <PasswordRules value={pw.password} />
        <Msg k="pw" note={note} />
        <button disabled={!pw.current || !passwordOk(pw.password)} className="px-6 py-2.5 rounded-xl font-bold bg-phytora-dark text-white hover:bg-phytora-mid transition disabled:opacity-50">Mettre à jour le mot de passe</button>
      </Card>

      <form className="bg-white rounded-2xl border border-red-200 p-8 space-y-4" onSubmit={run('del', async () => {
        if (!confirm('Supprimer définitivement votre compte et vos analyses ?')) return '';
        await api('/account', { method: 'DELETE', json: { password: del } }); await logout(); return '';
      })}>
        <h2 className="text-lg font-bold text-red-700">Supprimer mon compte</h2>
        <p className="text-sm text-gray-500">Cette action supprime votre compte et est irréversible. Vos analyses ne seront plus accessibles.</p>
        <div className="max-w-sm"><PasswordInput value={del} onChange={(e) => setDel(e.target.value)} autoComplete="current-password" placeholder="Votre mot de passe" /></div>
        <Msg k="del" note={note} />
        <button className="px-6 py-2.5 rounded-xl font-bold bg-red-600 text-white hover:bg-red-700 transition">Supprimer mon compte</button>
      </form>
    </div>
  );
}

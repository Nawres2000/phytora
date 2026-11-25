'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { passwordOk } from '@/lib/password';
import { useAuth } from '@/context/AuthContext';
import AuthShell from './AuthShell';
import PasswordInput from './PasswordInput';
import PasswordRules from './PasswordRules';

const COPY = {
  signin: { title: 'Bon retour !', sub: 'Connectez-vous pour accéder à votre tableau de bord.', cta: 'Se connecter', path: '/auth/signin', variant: 'login' },
  signup: { title: 'Créer un compte', sub: 'Commencez à analyser vos cultures dès aujourd’hui.', cta: 'S’inscrire gratuitement', path: '/auth/signup', variant: 'register' },
  forgot: { title: 'Mot de passe oublié', sub: 'Entrez votre e-mail : nous vous enverrons un lien de réinitialisation.', cta: 'Envoyer le lien', path: '/auth/forgot', variant: 'login' },
  reset: { title: 'Nouveau mot de passe', sub: 'Choisissez un mot de passe fort que vous n’utilisez nulle part ailleurs.', cta: 'Enregistrer', path: '/auth/reset', variant: 'login' },
};

const Label = ({ children, htmlFor }) => <label htmlFor={htmlFor} className="block text-sm font-semibold text-gray-700 mb-1.5">{children}</label>;

export default function AuthForm({ mode }) {
  const c = COPY[mode], router = useRouter(), { refresh } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [token, setToken] = useState('');
  const [err, setErr] = useState(''), [ok, setOk] = useState(''), [busy, setBusy] = useState(false), [needsVerify, setNeedsVerify] = useState(false);
  const strong = mode === 'signup' || mode === 'reset';
  useEffect(() => { setToken(new URLSearchParams(window.location.search).get('token') || ''); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setErr(''); setOk(''); setNeedsVerify(false); setBusy(true);
    try {
      const d = await api(c.path, { method: 'POST', json: { ...f, token } });
      if (mode === 'signin') { await refresh(); router.push('/dashboard'); return; }
      setOk(d.message);
      if (mode === 'signup') setF({ name: '', email: '', password: '' });
    } catch (x) { setErr(x.message); setNeedsVerify(!!x.data?.needsVerification); }
    setBusy(false);
  }
  async function resend() {
    try { const d = await api('/auth/resend', { method: 'POST', json: { email: f.email } }); setErr(''); setNeedsVerify(false); setOk(d.message); }
    catch (x) { setErr(x.message); }
  }

  return (
    <AuthShell variant={c.variant}>
      <h1 className="text-3xl font-extrabold text-gray-900 mb-2">{c.title}</h1>
      <p className="text-gray-500 mb-8">{c.sub}</p>
      <form onSubmit={submit} className="space-y-5">
        {mode === 'signup' && (<div><Label htmlFor="name">Nom</Label>
          <input id="name" required minLength={2} maxLength={60} value={f.name} onChange={set('name')} autoComplete="name" className="input-phytora" placeholder="Votre nom" /></div>)}
        {mode !== 'reset' && (<div><Label htmlFor="email">Adresse e-mail</Label>
          <input id="email" type="email" required value={f.email} onChange={set('email')} autoComplete="email" className="input-phytora" placeholder="vous@exemple.com" /></div>)}
        {mode !== 'forgot' && (<div>
          <div className="flex justify-between items-center mb-1.5">
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700">{mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}</label>
            {mode === 'signin' && <Link href="/forgot-password" className="text-xs text-phytora-accent hover:underline">Oublié ?</Link>}
          </div>
          <PasswordInput id="password" value={f.password} onChange={set('password')} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder={strong ? 'Créez un mot de passe fort' : '••••••••'} />
        </div>)}
        {strong && <PasswordRules value={f.password} />}
        {err && <p role="alert" className="p-3 rounded-xl bg-red-50 text-red-700 text-sm border border-red-100">{err}</p>}
        {needsVerify && <button type="button" onClick={resend} className="w-full py-2.5 rounded-xl border border-phytora-dark text-phytora-dark font-semibold hover:bg-phytora-light/10 transition">Renvoyer l’e-mail de confirmation</button>}
        {ok && <p role="status" className="p-3 rounded-xl bg-phytora-light/15 text-phytora-dark text-sm border border-phytora-light/30">{ok}</p>}
        <button type="submit" disabled={busy || (strong && !passwordOk(f.password))} className="btn-phytora mt-2">{busy ? 'Veuillez patienter…' : c.cta}</button>
      </form>
      <p className="text-center text-sm text-gray-600 mt-8">
        {mode === 'signin' && <>Pas encore de compte ? <Link href="/signup" className="text-phytora-dark font-bold hover:text-phytora-accent hover:underline">Créer un compte</Link></>}
        {mode === 'signup' && <>Déjà un compte ? <Link href="/signin" className="text-phytora-dark font-bold hover:text-phytora-accent hover:underline">Se connecter</Link></>}
        {(mode === 'forgot' || mode === 'reset') && <Link href="/signin" className="text-phytora-dark font-bold hover:text-phytora-accent hover:underline">Retour à la connexion</Link>}
      </p>
    </AuthShell>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import AuthShell from '@/components/AuthShell';

export default function VerifyEmail() {
  const [state, setState] = useState({ type: 'wait', text: 'Confirmation de votre e-mail…' });
  const started = useRef(false); // React strict mode runs effects twice in dev; the token is single-use

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) return setState({ type: 'error', text: 'Ce lien est incomplet.' });
    api('/auth/verify', { method: 'POST', json: { token } })
      .then((d) => setState({ type: 'success', text: d.message }))
      .catch((e) => setState({ type: 'error', text: e.message }));
  }, []);

  const tone = { wait: 'bg-gray-50 text-gray-600', success: 'bg-phytora-light/15 text-phytora-dark', error: 'bg-red-50 text-red-700' }[state.type];
  return (
    <AuthShell>
      <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Confirmation de l’e-mail</h1>
      <p role="status" className={`p-4 rounded-xl mb-6 ${tone}`}>{state.text}</p>
      {state.type !== 'wait' && <Link href="/signin" className="btn-phytora">Aller à la connexion</Link>}
    </AuthShell>
  );
}

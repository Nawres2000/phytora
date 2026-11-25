'use client';
import { useEffect, useRef, useState } from 'react';
import { Bot, Send } from 'lucide-react';
import { api } from '@/lib/api';

const GREETING = 'Bonjour ! Je suis l’assistant PHYTORA. Analysez une image, puis posez-moi vos questions sur la maladie, le traitement ou la prévention.';

function summary(d) {
  if (d.task === 'detection') return `J’ai détecté ${d.counts?.weeds ?? 0} mauvaises herbes et ${d.counts?.crops ?? 0} cultures. Voulez-vous des conseils de désherbage ?`;
  const x = d.disease;
  if (!x) return '';
  if (d.uncertain) return `Je ne suis pas sûr du diagnostic (meilleure piste : ${x.disease} sur ${x.plant_species.toLowerCase()}, ${Math.round(x.confidence * 100)} %). Reprenez une photo plus nette, ou décrivez-moi les symptômes que vous voyez.`;
  return x.is_healthy
    ? `Votre ${x.plant_species.toLowerCase()} semble saine (${Math.round(x.confidence * 100)} % de confiance). Posez-moi vos questions d’entretien.`
    : `Le modèle suggère : ${x.disease} sur ${x.plant_species.toLowerCase()} (${Math.round(x.confidence * 100)} % de confiance). Demandez-moi ce que cela signifie et comment traiter.`;
}

export default function Chat({ diagnosis }) {
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const log = useRef(null);

  useEffect(() => {
    if (diagnosis) setMsgs((m) => [...m, { role: 'assistant', content: summary(diagnosis) }]);
  }, [diagnosis?.scanId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [msgs, typing]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || typing) return;
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next); setInput(''); setTyping(true);
    try {
      const d = await api('/chat', { method: 'POST', json: { messages: next.slice(1), diagnosis: diagnosis ? { ...diagnosis, heatmap: undefined } : null } });
      setMsgs([...next, { role: 'assistant', content: d.reply }]);
    } catch (x) { setMsgs([...next, { role: 'assistant', content: x.message }]); }
    setTyping(false);
  }

  return (
    <section aria-label="Assistant PHYTORA" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[440px]">
      <div className="flex items-center gap-2 px-5 py-3 bg-phytora-dark text-white font-semibold"><Bot size={20} /> Assistant PHYTORA</div>
      <div ref={log} className="flex-1 overflow-y-auto p-5 space-y-3" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[80%] px-4 py-2.5 rounded-2xl whitespace-pre-wrap text-sm ${m.role === 'user' ? 'ml-auto bg-phytora-dark text-white rounded-br-sm' : 'bg-phytora-light/15 text-gray-800 rounded-bl-sm'}`}>{m.content}</div>
        ))}
        {typing && <div className="bg-phytora-light/15 w-fit px-4 py-3 rounded-2xl rounded-bl-sm text-sm text-gray-500" aria-label="L’assistant écrit">…</div>}
      </div>
      <form onSubmit={send} className="flex gap-2 p-3 border-t border-gray-100">
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} className="input-phytora" aria-label="Votre message"
          placeholder="Posez une question sur les symptômes, le traitement, la prévention…" />
        <button disabled={typing || !input.trim()} aria-label="Envoyer" className="px-4 rounded-xl bg-phytora-dark text-white hover:bg-phytora-mid transition disabled:opacity-50"><Send size={18} /></button>
      </form>
    </section>
  );
}

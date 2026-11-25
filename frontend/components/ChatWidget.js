'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Bot, Send, X, History, Plus, Mic, MicOff, ImagePlus, Square, ThumbsUp, ThumbsDown, Trash2, BookOpen, Leaf } from 'lucide-react';
import { api } from '@/lib/api';
import { streamChat, suggestionsFor } from '@/lib/chat';
import { resizeToDataUrl } from '@/lib/image';
import { useChat } from '@/context/ChatContext';

const GREETING = 'Bonjour ! Je suis l’assistant PHYTORA. Posez-moi vos questions sur les maladies des plantes, ou envoyez-moi une photo de feuille avec le bouton 🖼️.';

function summary(r) {
  const d = r?.disease;
  if (!d) return '';
  const pct = Math.round(d.confidence * 100);
  const sev = r.severity?.percent != null ? ` Environ **${r.severity.percent} %** de la feuille semble atteinte (sévérité ${r.severity.level}).` : '';
  if (r.uncertain) return `Je ne suis pas sûr du diagnostic (meilleure piste : **${d.disease}** sur ${d.plant_species.toLowerCase()}, ${pct} %). Reprenez une photo plus nette, ou décrivez-moi les symptômes.`;
  return d.is_healthy
    ? `Votre ${d.plant_species.toLowerCase()} semble **saine** (${pct} % de confiance). Posez-moi vos questions d’entretien.`
    : `Le modèle suggère : **${d.disease}** sur ${d.plant_species.toLowerCase()} (${pct} % de confiance).${sev} Que voulez-vous savoir ?`;
}

const Markdown = ({ children }) => (
  <ReactMarkdown components={{
    a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-phytora-accent">{c}</a>,
    ul: ({ children: c }) => <ul className="list-disc pl-5 space-y-1">{c}</ul>,
    ol: ({ children: c }) => <ol className="list-decimal pl-5 space-y-1">{c}</ol>,
    p: ({ children: c }) => <p className="mb-2 last:mb-0">{c}</p>,
    h1: ({ children: c }) => <p className="font-bold">{c}</p>,
    h2: ({ children: c }) => <p className="font-bold">{c}</p>,
    h3: ({ children: c }) => <p className="font-semibold">{c}</p>,
  }}>{children}</ReactMarkdown>
);

export default function ChatWidget() {
  const { open, setOpen, scan, setScan, request, clearRequest } = useChat();
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: GREETING }]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [view, setView] = useState('chat');
  const [convs, setConvs] = useState([]);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const log = useRef(null), abort = useRef(null), recog = useRef(null), fileRef = useRef(null), lastScan = useRef(null);

  const reset = useCallback((withScan) => {
    abort.current?.abort();
    setConversationId(null);
    setMsgs([{ role: 'assistant', content: withScan ? summary(withScan) : GREETING }]);
    setView('chat');
    setError('');
  }, []);

  // a new diagnosis starts a new conversation about it
  useEffect(() => {
    if (scan?.scanId && scan.scanId !== lastScan.current) {
      lastScan.current = scan.scanId;
      reset(scan);
    }
  }, [scan, reset]);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [msgs, open, view]);

  const send = useCallback(async (raw) => {
    const text = (raw ?? '').trim();
    if (!text || busy) return;
    setInput(''); setError(''); setBusy(true); setStreaming(true);
    setMsgs((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true, sources: [] }]);
    const patchLast = (fn) => setMsgs((m) => { const c = [...m]; c[c.length - 1] = fn(c[c.length - 1]); return c; });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await streamChat({ message: text, conversationId, scanId: scan?.scanId }, {
        onMeta: (d) => { setConversationId(d.conversationId); patchLast((x) => ({ ...x, sources: d.sources })); },
        onToken: (t) => patchLast((x) => ({ ...x, content: x.content + t })),
        onDone: (d) => patchLast((x) => ({ ...x, streaming: false, index: d.index, rating: 0 })),
        onError: (e) => patchLast((x) => ({ ...x, streaming: false, content: x.content || e, failed: true })),
      }, ctrl.signal);
    } catch (e) {
      if (e.name !== 'AbortError') patchLast((x) => ({ ...x, content: x.content || e.message, failed: true }));
    }
    patchLast((x) => ({ ...x, streaming: false }));
    abort.current = null;
    setStreaming(false);
    setBusy(false);
  }, [busy, conversationId, scan]);

  // a page asked a question on our behalf (e.g. "Discuter de ce diagnostic")
  useEffect(() => {
    if (request && open && !busy) { clearRequest(); send(request.text); }
  }, [request, open, busy, send, clearRequest]);

  async function rate(i, value) {
    const m = msgs[i];
    if (!conversationId || m.index == null) return;
    const rating = m.rating === value ? 0 : value;
    setMsgs((all) => all.map((x, k) => (k === i ? { ...x, rating } : x)));
    try { await api(`/chat/conversations/${conversationId}/messages/${m.index}`, { method: 'PATCH', json: { rating } }); } catch {}
  }

  async function showHistory() {
    setView('history');
    try { setConvs((await api('/chat/conversations')).conversations); } catch (e) { setError(e.message); }
  }

  async function openConversation(id) {
    try {
      const { conversation: c } = await api(`/chat/conversations/${id}`);
      setConversationId(c._id);
      setMsgs(c.messages.map((m, index) => ({ ...m, index })));
      setScan(c.scan ? { scanId: c.scan._id, disease: { plant_species: c.scan.plant, disease: c.scan.disease, is_healthy: c.scan.isHealthy, confidence: c.scan.confidence }, uncertain: c.scan.uncertain, severity: c.scan.severity } : null);
      lastScan.current = c.scan?._id ?? null;
      setView('chat');
    } catch (e) { setError(e.message); }
  }

  async function removeConversation(id) {
    try { await api(`/chat/conversations/${id}`, { method: 'DELETE' }); setConvs((c) => c.filter((x) => x._id !== id)); if (id === conversationId) reset(null); } catch (e) { setError(e.message); }
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    setMsgs((m) => [...m, { role: 'user', content: '📷 Photo envoyée pour analyse…' }]);
    try {
      const form = new FormData();
      form.append('file', file);
      try { form.append('thumb', await resizeToDataUrl(file)); } catch {}
      const result = await api('/predict', { method: 'POST', body: form });
      lastScan.current = result.scanId; // keep this conversation, just attach the new scan
      setScan(result);
      setMsgs((m) => [...m, { role: 'assistant', content: summary(result) }]);
    } catch (x) { setMsgs((m) => [...m, { role: 'assistant', content: x.message, failed: true }]); }
    setBusy(false);
  }

  function toggleMic() {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) { setError('La dictée vocale n’est pas prise en charge par ce navigateur (essayez Chrome ou Edge).'); return; }
    if (listening) { recog.current?.stop(); return; }
    const r = new SR();
    r.lang = navigator.language?.startsWith('ar') ? 'ar-TN' : navigator.language?.startsWith('en') ? 'en-US' : 'fr-FR';
    r.interimResults = true;
    r.onresult = (ev) => setInput(Array.from(ev.results).map((x) => x[0].transcript).join(' '));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recog.current = r;
    setListening(true);
    r.start();
  }

  const askedSomething = msgs.some((m) => m.role === 'user');

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} aria-label="Ouvrir l’assistant PHYTORA"
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-phytora-dark text-white shadow-xl hover:bg-phytora-mid hover:scale-105 transition flex items-center justify-center">
        <Bot size={26} />
        {scan?.scanId && !askedSomething && <span className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-phytora-warn border-2 border-white animate-pulse" />}
      </button>
    );
  }

  return (
    <section aria-label="Assistant PHYTORA" className="fixed z-50 bottom-0 right-0 sm:bottom-5 sm:right-5 w-full sm:w-[420px] h-[85vh] sm:h-[620px] bg-white sm:rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 bg-phytora-dark text-white">
        <Bot size={20} />
        <span className="font-semibold flex-1">Assistant PHYTORA</span>
        <button onClick={view === 'history' ? () => setView('chat') : showHistory} title="Historique des conversations" aria-label="Historique" className="p-1.5 rounded-lg hover:bg-white/15"><History size={18} /></button>
        <button onClick={() => { setScan(null); lastScan.current = null; reset(null); }} title="Nouvelle conversation" aria-label="Nouvelle conversation" className="p-1.5 rounded-lg hover:bg-white/15"><Plus size={18} /></button>
        <button onClick={() => setOpen(false)} title="Fermer" aria-label="Fermer l’assistant" className="p-1.5 rounded-lg hover:bg-white/15"><X size={18} /></button>
      </header>

      {view === 'history' ? (
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-2 mb-2">Vos conversations</p>
          {convs.length === 0 && <p className="text-sm text-gray-500 px-2">Aucune conversation enregistrée.</p>}
          <ul className="space-y-1">
            {convs.map((c) => (
              <li key={c._id} className="flex items-center gap-2 rounded-xl hover:bg-gray-50">
                <button onClick={() => openConversation(c._id)} className="flex-1 text-left px-3 py-2 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.scan && <Leaf size={12} className="inline mr-1 text-phytora-mid" />}{c.title}</p>
                  <p className="text-xs text-gray-400">{new Date(c.updatedAt).toLocaleString('fr-FR')} · {c.messages} messages</p>
                </button>
                <button onClick={() => removeConversation(c._id)} aria-label="Supprimer la conversation" className="p-2 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {scan?.disease && (
            <div className="px-4 py-2 bg-phytora-light/10 border-b border-phytora-light/30 text-xs text-phytora-dark flex items-center gap-2">
              <Leaf size={14} />
              <span className="flex-1 truncate">Diagnostic lié : <b>{scan.disease.plant_species}</b> · {scan.disease.disease} ({Math.round(scan.disease.confidence * 100)} %)</span>
              <button onClick={() => { setScan(null); lastScan.current = null; }} aria-label="Détacher le diagnostic" className="hover:text-red-600"><X size={14} /></button>
            </div>
          )}
          <div ref={log} className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[88%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-phytora-dark text-white rounded-br-sm whitespace-pre-wrap' : m.failed ? 'bg-red-50 text-red-700 rounded-bl-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                  {m.role === 'user' ? m.content : (m.content ? <Markdown>{m.content}</Markdown> : <span className="inline-flex gap-1" aria-label="L’assistant écrit"><span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" /><span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" /><span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" /></span>)}
                  {m.streaming && m.content && <span className="inline-block w-1.5 h-4 bg-gray-500 ml-0.5 align-middle animate-pulse" />}
                </div>
                {m.role === 'assistant' && !m.streaming && (m.sources?.length > 0 || m.index != null) && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5 ml-1">
                    {m.sources?.map((s, k) => (
                      <Link key={s.classId} href={`/dashboard/guide?class=${encodeURIComponent(s.classId)}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-phytora-light/15 text-phytora-dark hover:bg-phytora-light/30">
                        <BookOpen size={11} /> [{k + 1}] {s.title}
                      </Link>
                    ))}
                    {m.index != null && (
                      <span className="ml-auto flex gap-1">
                        <button onClick={() => rate(i, 1)} aria-label="Réponse utile" aria-pressed={m.rating === 1} className={`p-1 rounded ${m.rating === 1 ? 'text-green-600 bg-green-50' : 'text-gray-400 hover:text-green-600'}`}><ThumbsUp size={13} /></button>
                        <button onClick={() => rate(i, -1)} aria-label="Réponse peu utile" aria-pressed={m.rating === -1} className={`p-1 rounded ${m.rating === -1 ? 'text-red-600 bg-red-50' : 'text-gray-400 hover:text-red-600'}`}><ThumbsDown size={13} /></button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!askedSomething && !busy && (
              <div className="flex flex-wrap gap-2 pt-1">
                {suggestionsFor(scan?.disease ? scan : null).map((q) => (
                  <button key={q} onClick={() => send(q)} className="text-xs px-3 py-1.5 rounded-full border border-phytora-light/60 text-phytora-dark hover:bg-phytora-light/15 text-left">{q}</button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {error && <p role="alert" className="px-4 py-2 text-xs text-red-600 bg-red-50">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-1.5 p-3 border-t border-gray-100">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPhoto} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} title="Analyser une photo" aria-label="Envoyer une photo à analyser" className="p-2.5 rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-40"><ImagePlus size={18} /></button>
        <button type="button" onClick={toggleMic} title="Dicter" aria-label={listening ? 'Arrêter la dictée' : 'Dicter un message'} aria-pressed={listening} className={`p-2.5 rounded-xl ${listening ? 'text-red-600 bg-red-50 animate-pulse' : 'text-gray-500 hover:bg-gray-100'}`}>{listening ? <MicOff size={18} /> : <Mic size={18} />}</button>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={1500} aria-label="Votre message"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Symptômes, traitement, prévention…" className="input-phytora resize-none !py-2.5 max-h-28" />
        {streaming
          ? <button type="button" onClick={() => abort.current?.abort()} aria-label="Arrêter la réponse" className="p-2.5 rounded-xl bg-gray-700 text-white hover:bg-gray-800"><Square size={18} /></button>
          : <button disabled={busy || !input.trim()} aria-label="Envoyer" className="p-2.5 rounded-xl bg-phytora-dark text-white hover:bg-phytora-mid disabled:opacity-40"><Send size={18} /></button>}
      </form>
    </section>
  );
}

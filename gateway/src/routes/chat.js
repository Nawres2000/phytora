import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import Conversation from '../models/Conversation.js';
import Scan from '../models/Scan.js';
import { contextBlock, retrieve } from '../utils/knowledge.js';

// PHYTORA assistant: Groq (OpenAI-compatible chat API), answers streamed to the browser with
// Server-Sent Events, grounded on the disease catalog (retrieval) and on the user's own diagnosis.
const r = Router();
r.use(requireAuth);

const LLM_URL = () => process.env.CHAT_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const short = (v, n = 80) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
const validId = (id) => mongoose.isValidObjectId(id);

const SYSTEM = `You are the PHYTORA assistant, a friendly plant pathology and crop care advisor for farmers and gardeners.
- Reply in the user's language (French by default; Arabic or English if the user writes in it).
- Be practical and concise: short paragraphs or bullet lists, Markdown allowed (bold, lists), no tables.
- Prefer the reference sheets given below; cite them as [1], [2]. If they do not cover the question, say so and answer from general knowledge with care.
- Say when you are unsure and when a local agronomist or plant protection service should check.
- Never give pesticide dosages or mixing instructions; point to the product label and local regulations.
- The model diagnosis is an AI estimate trained on laboratory photos: treat it as a hint, not a certainty.`;

function describeScan(s) {
  if (!s) return '';
  const pct = Math.round((Number(s.confidence) || 0) * 100);
  const alts = (s.topK || []).slice(1, 3).map((c) => `${short(c.classId, 60)} (${Math.round((Number(c.score) || 0) * 100)}%)`).join('; ');
  return `\n\nUSER'S LAST DIAGNOSIS: plant "${short(s.plant)}", ${s.isHealthy ? 'healthy' : `disease "${short(s.disease)}"`}, confidence ${pct}%`
    + (s.uncertain ? ', flagged UNCERTAIN by the model (say so and suggest retaking a clearer photo)' : '')
    + (s.severity?.percent != null ? `, estimated severity ${s.severity.percent}% of the leaf (${s.severity.level})` : '')
    + (alts ? `; other candidates: ${alts}` : '')
    + (s.mock ? ' (demo result, not reliable)' : '') + '.';
}

const listItem = (c) => ({ _id: c._id, title: c.title, scan: c.scan, updatedAt: c.updatedAt, messages: c.messages?.length ?? 0 });

r.get('/conversations', async (req, res) => {
  const convs = await Conversation.find({ user: req.userId }).sort({ updatedAt: -1 }).limit(30).select('title scan updatedAt messages.role');
  res.json({ conversations: convs.map(listItem) });
});

r.get('/conversations/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Conversation introuvable.' });
  const conv = await Conversation.findOne({ _id: req.params.id, user: req.userId }).populate('scan', 'plant disease isHealthy confidence uncertain severity thumb');
  if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
  res.json({ conversation: conv });
});

r.delete('/conversations/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Conversation introuvable.' });
  const out = await Conversation.deleteOne({ _id: req.params.id, user: req.userId });
  if (!out.deletedCount) return res.status(404).json({ error: 'Conversation introuvable.' });
  res.json({ ok: true });
});

// 👍 / 👎 on an assistant answer (quality monitoring in the admin page)
r.patch('/conversations/:id/messages/:index', async (req, res) => {
  const rating = Number(req.body?.rating), i = Number(req.params.index);
  if (![-1, 0, 1].includes(rating) || !Number.isInteger(i) || !validId(req.params.id)) return res.status(400).json({ error: 'Requête invalide.' });
  const conv = await Conversation.findOne({ _id: req.params.id, user: req.userId });
  if (!conv || conv.messages[i]?.role !== 'assistant') return res.status(404).json({ error: 'Message introuvable.' });
  conv.messages[i].rating = rating;
  await conv.save();
  res.json({ ok: true });
});

// Ask a question. Response: text/event-stream with events meta | token | done | error
r.post('/', async (req, res) => {
  const text = String(req.body?.message ?? '').trim().slice(0, 2000);
  const { conversationId, scanId } = req.body ?? {};
  if (!text) return res.status(400).json({ error: 'Message vide.' });

  let conv = null;
  if (conversationId) {
    if (!validId(conversationId)) return res.status(404).json({ error: 'Conversation introuvable.' });
    conv = await Conversation.findOne({ _id: conversationId, user: req.userId });
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable.' });
  }
  if (!conv) conv = new Conversation({ user: req.userId, title: short(text, 60) });
  if (scanId && validId(scanId) && String(conv.scan) !== String(scanId)) {
    const owned = await Scan.exists({ _id: scanId, user: req.userId }); // never attach another user's scan
    if (owned) conv.scan = scanId;
  }
  const scan = conv.scan ? await Scan.findOne({ _id: conv.scan, user: req.userId }).lean() : null;

  const history = conv.messages.slice(-10).map(({ role, content }) => ({ role, content }));
  const docs = retrieve(`${text} ${history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join(' ')}`,
    { prefer: scan?.classId, k: 3 });
  const sources = docs.map((d) => ({ classId: d.id, title: d.title }));
  conv.messages.push({ role: 'user', content: text });
  await conv.save();

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('meta', { conversationId: conv._id, title: conv.title, sources });

  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort()); // the user closed the panel: stop generating
  let answer = '';
  try {
    const resp = await fetch(LLM_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(60000)]),
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
        messages: [{ role: 'system', content: SYSTEM + describeScan(scan) + contextBlock(docs) }, ...history, { role: 'user', content: text }],
        temperature: 0.4,
        stream: true,
      }),
    });
    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`LLM HTTP ${resp.status} ${detail.slice(0, 300)}`); // e.g. "model ... has been decommissioned"
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of resp.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, '').trim();
        if (!line.startsWith('data:') || !payload || payload === '[DONE]') continue;
        try {
          const token = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (token) { answer += token; send('token', { text: token }); }
        } catch { /* partial or keep-alive line */ }
      }
    }
    if (!answer) throw new Error('empty answer');
    conv.messages.push({ role: 'assistant', content: answer.slice(0, 8000), sources });
    await conv.save();
    send('done', { index: conv.messages.length - 1 });
  } catch (e) {
    if (!ctrl.signal.aborted) {
      console.error('chat:', e.message);
      send('error', { error: "L'assistant est indisponible. Vérifiez la clé API Groq puis réessayez." });
    } else if (answer) {
      conv.messages.push({ role: 'assistant', content: answer.slice(0, 8000), sources });
      await conv.save().catch(() => {});
    }
  }
  res.end();
});

export default r;

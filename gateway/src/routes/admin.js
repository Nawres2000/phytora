import { Router } from 'express';
import User from '../models/User.js';
import Scan from '../models/Scan.js';
import Conversation from '../models/Conversation.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth, requireAdmin);
const SAFE = '-password -resetTokenHash -verifyTokenHash -resetExpires -verifyExpires -avatar';
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

r.get('/stats', async (req, res) => {
  const week = new Date(Date.now() - 7 * 864e5);
  const [total, verified, admins, disabled, newThisWeek, scans, uncertain, feedbackTotal, feedbackCorrect] = await Promise.all([
    User.countDocuments(), User.countDocuments({ emailVerified: true }), User.countDocuments({ role: 'admin' }),
    User.countDocuments({ disabled: true }), User.countDocuments({ createdAt: { $gte: week } }),
    Scan.countDocuments(), Scan.countDocuments({ uncertain: true }),
    Scan.countDocuments({ 'feedback.correct': { $exists: true } }), Scan.countDocuments({ 'feedback.correct': true }),
  ]);
  const [conversations, ratings, latency] = await Promise.all([
    Conversation.countDocuments(),
    Conversation.aggregate([{ $unwind: '$messages' }, { $match: { 'messages.role': 'assistant' } },
      { $group: { _id: null, answers: { $sum: 1 }, up: { $sum: { $cond: [{ $eq: ['$messages.rating', 1] }, 1, 0] } },
        down: { $sum: { $cond: [{ $eq: ['$messages.rating', -1] }, 1, 0] } } } }]),
    Scan.aggregate([{ $match: { mock: { $ne: true }, latencyMs: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$latencyMs' }, inference: { $avg: '$inferenceMs' } } }]),
  ]);
  const chat = ratings[0] || { answers: 0, up: 0, down: 0 };
  res.json({ total, verified, admins, disabled, newThisWeek, scans, uncertain, feedbackTotal, feedbackCorrect,
    conversations, chatAnswers: chat.answers, chatUp: chat.up, chatDown: chat.down,
    avgLatencyMs: latency[0]?.avg ?? null, avgInferenceMs: latency[0]?.inference ?? null });
});

r.get('/users', async (req, res) => {
  const limit = 15, page = Math.max(1, +req.query.page || 1), q = (req.query.q || '').trim();
  const filter = q ? { $or: [{ name: new RegExp(escape(q), 'i') }, { email: new RegExp(escape(q), 'i') }] } : {};
  const [users, total] = await Promise.all([
    User.find(filter).select(SAFE).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ users, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

r.patch('/users/:id', async (req, res) => {
  if (req.params.id === String(req.userId)) return res.status(400).json({ error: "Vous ne pouvez pas modifier votre propre rôle ou statut." });
  const update = {};
  if (['user', 'admin'].includes(req.body.role)) update.role = req.body.role;
  if (typeof req.body.disabled === 'boolean') update.disabled = req.body.disabled;
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select(SAFE);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ user });
});

r.delete('/users/:id', async (req, res) => {
  if (req.params.id === String(req.userId)) return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte ici. Utilisez la page Profil." });
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  await Promise.all([Scan.deleteMany({ user: req.params.id }), Conversation.deleteMany({ user: req.params.id })]);
  res.json({ ok: true });
});

export default r;

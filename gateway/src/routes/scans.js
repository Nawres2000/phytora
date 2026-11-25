import { Router } from 'express';
import mongoose from 'mongoose';
import Scan from '../models/Scan.js';
import { isClass } from '../utils/catalog.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();
r.use(requireAuth);

r.get('/', async (req, res) => {
  const scans = await Scan.find({ user: req.userId }).sort({ createdAt: -1 }).limit(100).select('-__v');
  res.json({ scans });
});

r.get('/stats', async (req, res) => {
  const user = req.userId, week = new Date(Date.now() - 7 * 864e5);
  const [total, healthy, diseased, last7, recent] = await Promise.all([
    Scan.countDocuments({ user }),
    Scan.countDocuments({ user, isHealthy: true, uncertain: { $ne: true } }),
    Scan.countDocuments({ user, isHealthy: false, uncertain: { $ne: true } }),
    Scan.countDocuments({ user, createdAt: { $gte: week } }),
    Scan.find({ user }).sort({ createdAt: -1 }).limit(5).select('-__v'),
  ]);
  res.json({ total, healthy, diseased, last7, recent });
});

// "Was this diagnosis correct?" feedback (builds a labelled dataset and an accuracy estimate)
r.patch('/:id/feedback', async (req, res) => {
  const { correct, actualClass } = req.body;
  if (typeof correct !== 'boolean') return res.status(400).json({ error: 'Réponse invalide.' });
  if (actualClass !== undefined && actualClass !== null && !isClass(actualClass)) return res.status(400).json({ error: 'Classe inconnue.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Analyse introuvable.' });
  const scan = await Scan.findOneAndUpdate(
    { _id: req.params.id, user: req.userId },
    { feedback: { correct, actualClass: correct ? undefined : actualClass || undefined, at: new Date() } },
    { new: true },
  ).select('-__v');
  if (!scan) return res.status(404).json({ error: 'Analyse introuvable.' });
  res.json({ scan });
});

r.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Analyse introuvable.' });
  const out = await Scan.deleteOne({ _id: req.params.id, user: req.userId });
  if (!out.deletedCount) return res.status(404).json({ error: 'Analyse introuvable.' });
  res.json({ ok: true });
});

export default r;

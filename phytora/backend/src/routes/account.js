import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Scan from '../models/Scan.js';
import { requireAuth } from '../middleware/auth.js';
import { emailError, passwordError } from '../utils/validate.js';
import { issueVerification } from '../utils/tokens.js';
import { pub } from './auth.js';

const r = Router();
r.use(requireAuth);

const checkPassword = (user, pw) => bcrypt.compare(pw || '', user.password);

r.patch('/profile', async (req, res) => {
  const { name, avatar } = req.body;
  if (name !== undefined) {
    const n = String(name).trim();
    if (n.length < 2 || n.length > 60) return res.status(400).json({ error: 'Entrez votre nom (2 à 60 caractères).' });
    req.user.name = n;
  }
  if (avatar !== undefined) {
    if (avatar === null || avatar === '') req.user.avatar = undefined;
    else if (typeof avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(avatar) && avatar.length <= 150000) req.user.avatar = avatar;
    else return res.status(400).json({ error: 'Image de profil invalide ou trop volumineuse.' });
  }
  await req.user.save();
  res.json({ user: pub(req.user) });
});

// New address is only applied once the link sent to it is clicked.
r.post('/email', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!(await checkPassword(req.user, req.body.password))) return res.status(401).json({ error: 'Votre mot de passe actuel est incorrect.' });
  if (email === req.user.email) return res.status(400).json({ error: 'C\'est déjà votre adresse e-mail.' });
  const bad = await emailError(email);
  if (bad) return res.status(400).json({ error: bad });
  if (await User.findOne({ email })) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
  req.user.pendingEmail = email;
  await issueVerification(req.user, email);
  res.json({ user: pub(req.user), message: `Un lien de confirmation a été envoyé à ${email}. Votre e-mail changera une fois le lien cliqué.` });
});

r.post('/password', async (req, res) => {
  if (!(await checkPassword(req.user, req.body.current))) return res.status(401).json({ error: 'Votre mot de passe actuel est incorrect.' });
  const bad = passwordError(req.body.password);
  if (bad) return res.status(400).json({ error: bad });
  req.user.password = await bcrypt.hash(req.body.password, 12);
  await req.user.save();
  res.json({ message: 'Mot de passe mis à jour.' });
});

r.delete('/', async (req, res) => {
  if (!(await checkPassword(req.user, req.body.password))) return res.status(401).json({ error: 'Votre mot de passe est incorrect.' });
  if (req.user.role === 'admin' && (await User.countDocuments({ role: 'admin' })) < 2)
    return res.status(400).json({ error: "Vous êtes le seul administrateur. Nommez d'abord un autre administrateur." });
  await Scan.deleteMany({ user: req.userId });
  await req.user.deleteOne();
  res.clearCookie('token').json({ ok: true });
});

export default r;

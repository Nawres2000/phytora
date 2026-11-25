import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { sendResetEmail } from '../utils/mail.js';
import { emailError, passwordError } from '../utils/validate.js';
import { sha, newToken, issueVerification, isAdminEmail } from '../utils/tokens.js';

const r = Router();
const setCookie = (res, id) =>
  res.cookie('token', jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' }), {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production', maxAge: 7 * 864e5,
  });
export const pub = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, avatar: u.avatar, pendingEmail: u.pendingEmail, createdAt: u.createdAt });

r.post('/signup', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Entrez votre nom (2 à 60 caractères).' });
  const bad = (await emailError(email)) || passwordError(req.body.password);
  if (bad) return res.status(400).json({ error: bad });
  if (await User.findOne({ email })) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
  const user = await User.create({
    name, email, password: await bcrypt.hash(req.body.password, 12),
    role: isAdminEmail(email) ? 'admin' : 'user',
  });
  await issueVerification(user, email);
  res.status(201).json({ message: 'Compte créé. Consultez votre boîte mail et cliquez sur le lien de confirmation avant de vous connecter.' });
});

r.post('/signin', async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password)))
    return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  if (user.disabled) return res.status(403).json({ error: 'Ce compte a été désactivé.' });
  if (!user.emailVerified)
    return res.status(403).json({ error: 'Confirmez d\'abord votre e-mail. Consultez votre boîte mail.', needsVerification: true });
  if (isAdminEmail(user.email) && user.role !== 'admin') { user.role = 'admin'; await user.save(); }
  setCookie(res, user._id);
  res.json({ user: pub(user) });
});

r.post('/resend', async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').trim().toLowerCase() });
  if (user && !user.emailVerified && !user.disabled) await issueVerification(user, user.email);
  res.json({ message: 'Si ce compte doit encore être confirmé, un nouveau lien vient de vous être envoyé.' });
});

r.post('/verify', async (req, res) => {
  const user = await User.findOne({ verifyTokenHash: sha(req.body.token || ''), verifyExpires: { $gt: Date.now() } });
  if (!user) return res.status(400).json({ error: 'Ce lien de confirmation est invalide ou a expiré.' });
  if (user.pendingEmail) {
    if (await User.findOne({ email: user.pendingEmail, _id: { $ne: user._id } }))
      return res.status(409).json({ error: 'Cette adresse e-mail est maintenant utilisée par un autre compte.' });
    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
  }
  user.emailVerified = true;
  user.verifyTokenHash = user.verifyExpires = undefined;
  await user.save();
  res.json({ message: 'E-mail confirmé. Vous pouvez vous connecter.' });
});

r.post('/signout', (req, res) => res.clearCookie('token').json({ ok: true }));

r.get('/me', requireAuth, (req, res) => res.json({ user: pub(req.user) }));

r.post('/forgot', async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').trim().toLowerCase() });
  if (user && !user.disabled) {
    const [token, hash] = newToken();
    user.resetTokenHash = hash;
    user.resetExpires = Date.now() + 30 * 60 * 1000;
    await user.save();
    await sendResetEmail(user.email, `${process.env.FRONTEND_URL}/reset-password?token=${token}`).catch(console.error);
  }
  res.json({ message: 'Si un compte existe pour cet e-mail, un lien de réinitialisation vient d\'être envoyé.' });
});

r.post('/reset', async (req, res) => {
  const bad = passwordError(req.body.password);
  if (bad) return res.status(400).json({ error: bad });
  const user = await User.findOne({ resetTokenHash: sha(req.body.token || ''), resetExpires: { $gt: Date.now() } });
  if (!user) return res.status(400).json({ error: 'Ce lien de réinitialisation est invalide ou a expiré. Demandez-en un nouveau.' });
  user.password = await bcrypt.hash(req.body.password, 12);
  user.emailVerified = true; // they received the link in their inbox
  user.resetTokenHash = user.resetExpires = undefined;
  await user.save();
  res.json({ message: 'Mot de passe mis à jour. Vous pouvez vous connecter.' });
});

export default r;

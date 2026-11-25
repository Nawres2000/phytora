import crypto from 'crypto';
import { sendVerifyEmail } from './mail.js';

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = () => { const t = crypto.randomBytes(32).toString('hex'); return [t, sha(t)]; };

// Stores a hashed 24h token on the user and emails the link to `to`.
export async function issueVerification(user, to) {
  const [token, hash] = newToken();
  user.verifyTokenHash = hash;
  user.verifyExpires = Date.now() + 24 * 3600 * 1000;
  await user.save();
  await sendVerifyEmail(to, `${process.env.FRONTEND_URL}/verify-email?token=${token}`).catch(console.error);
}

export const isAdminEmail = (email) =>
  (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).includes(email.toLowerCase());

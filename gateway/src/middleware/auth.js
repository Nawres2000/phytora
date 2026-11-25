import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    const user = await User.findById(id);
    if (!user || user.disabled) throw new Error('no access');
    req.user = user;
    req.userId = user._id;
    next();
  } catch {
    res.status(401).json({ error: 'Veuillez vous connecter pour continuer.' });
  }
}

export const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Réservé aux administrateurs.' });

import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import auth from './routes/auth.js';
import api from './routes/api.js';
import account from './routes/account.js';
import admin from './routes/admin.js';
import scans from './routes/scans.js';

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY)); // set to 1 behind one reverse proxy

const limiter = (minutes, limit, error) => rateLimit({
  windowMs: minutes * 60 * 1000, limit, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error }, skip: () => process.env.NODE_ENV === 'test',
});
const TOO_MANY = 'Trop de tentatives. Réessayez dans quelques minutes.';

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '300kb' })); // room for the small avatar data URL
app.use(cookieParser());
app.use('/api', limiter(15, 600, TOO_MANY));
app.use(['/api/auth/signin', '/api/auth/signup', '/api/auth/forgot', '/api/auth/resend', '/api/auth/reset', '/api/auth/verify'], limiter(15, 15, TOO_MANY));
app.use('/api/predict', limiter(10, 60, 'Trop d’analyses en peu de temps. Patientez quelques minutes.'));
app.use('/api/chat', limiter(10, 40, 'Trop de messages en peu de temps. Patientez quelques minutes.'));

app.use('/api/auth', auth);
app.use('/api/account', account);
app.use('/api/admin', admin);
app.use('/api/scans', scans);
app.use('/api', api);
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image trop volumineuse (8 Mo maximum).' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
});

export default app;

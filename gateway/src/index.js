import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';

for (const k of ['MONGO_URI', 'JWT_SECRET', 'FRONTEND_URL']) {
  if (!process.env[k]) { console.error(`Missing ${k} in .env`); process.exit(1); }
}
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters in production.'); process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
app.listen(process.env.PORT || 5000, () => console.log('API ready on port', process.env.PORT || 5000));

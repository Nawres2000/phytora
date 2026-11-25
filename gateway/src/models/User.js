import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  disabled: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  avatar: { type: String, maxlength: 150000 },
  pendingEmail: String,
  verifyTokenHash: String,
  verifyExpires: Date,
  resetTokenHash: String,
  resetExpires: Date,
}, { timestamps: true });
export default mongoose.model('User', schema);

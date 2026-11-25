import mongoose from 'mongoose';

const message = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, maxlength: 8000 },
  sources: [{ _id: false, classId: String, title: String }],
  rating: { type: Number, enum: [-1, 0, 1], default: 0 },
  at: { type: Date, default: Date.now },
});

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: 'Nouvelle conversation', maxlength: 120 },
  scan: { type: mongoose.Schema.Types.ObjectId, ref: 'Scan' },
  messages: [message],
}, { timestamps: true });

export default mongoose.model('Conversation', schema);

import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  task: { type: String, enum: ['classification', 'detection'], required: true },
  classId: String,
  topK: [{ _id: false, classId: String, score: Number }],
  uncertain: { type: Boolean, default: false },
  modelVersion: String,
  feedback: { correct: Boolean, actualClass: String, at: Date },
  plant: String,
  disease: String,
  isHealthy: Boolean,
  confidence: Number,
  weeds: Number,
  crops: Number,
  latencyMs: Number,
  mock: { type: Boolean, default: false },
  thumb: { type: String, maxlength: 40000 },
}, { timestamps: true });
export default mongoose.model('Scan', schema);

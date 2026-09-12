import mongoose from 'mongoose';

/** Report — abuse/quality reports; feed the admin queue and the auto-flag ECA rule. */
const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['resource', 'material', 'user'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: ['spam', 'offensive', 'wrong-info', 'stolen', 'other'], required: true },
    details: { type: String, default: '', maxlength: 600 },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });

export default mongoose.model('Report', reportSchema);

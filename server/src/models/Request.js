import mongoose from 'mongoose';

/**
 * Request — either an "availability alert" subscription on an unavailable
 * resource (used by the Active DB rule: notify-on-availability) or an
 * exchange offer against a listing.
 */
const requestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
    type: { type: String, enum: ['availability-alert', 'exchange-offer'], required: true },
    message: { type: String, default: '', maxlength: 400 },
    status: { type: String, enum: ['open', 'fulfilled', 'cancelled'], default: 'open' },
  },
  { timestamps: true }
);

requestSchema.index({ resource: 1, status: 1, type: 1 });

export default mongoose.model('Request', requestSchema);

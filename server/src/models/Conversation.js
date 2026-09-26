import mongoose from 'mongoose';

/**
 * Conversation — a direct message thread between two students, optionally
 * anchored to a listing ("is this still available?") or to a deal.
 * MongoDB document store; the realtime hop is Socket.io (Active layer transport).
 */
const conversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }],
    // deterministic key (sorted ids) so a pair can only ever have one thread
    pairKey: { type: String, required: true, unique: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', default: null },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    subject: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '' },
    lastSender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // per-user unread counters: { "<userId>": 3 }
    unread: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export default mongoose.model('Conversation', conversationSchema);

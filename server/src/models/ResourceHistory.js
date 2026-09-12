import mongoose from 'mongoose';

/**
 * TEMPORAL PARADIGM — ResourceHistory
 * Versioned snapshots of a resource's lifecycle state using the
 * "validFrom / validTo" valid-time interval pattern, with bi-temporal support:
 *
 *   validFrom / validTo  → VALID time  (when the state was true in the real world)
 *   recordedAt           → TRANSACTION time (when the DB learned it)
 *
 * Every state change (owner change, price change, condition change, lend/return
 * cycle…) closes the current interval (validTo = now) and inserts a new snapshot.
 * Powers the per-resource visual timeline; previous owners are anonymized.
 */
const resourceHistorySchema = new mongoose.Schema(
  {
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, default: null }, // null = current state
    recordedAt: { type: Date, required: true, default: Date.now }, // transaction time
    source: { type: String, enum: ['user', 'system', 'automation'], default: 'user' },
    actorLabel: { type: String, default: 'user' }, // anonymized: "A*** S***" / "system:cron"
    snapshot: {
      title: String,
      price: Number,
      condition: String,
      listingType: String,
      availability: String,
      ownerId: mongoose.Schema.Types.ObjectId,
      ownerName: String, // stored anonymized for public timelines
      category: String,
      subject: String,
    },
    change: {
      fields: [{ type: String }],
      summary: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

resourceHistorySchema.index({ resource: 1, validFrom: -1 });

export default mongoose.model('ResourceHistory', resourceHistorySchema);

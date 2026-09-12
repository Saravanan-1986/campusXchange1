import mongoose from 'mongoose';

/**
 * ACTIVE DB PARADIGM support — DbEvent log.
 * Every Event-Condition-Action firing (change stream, cron job, automation)
 * and every DB-technology touchpoint writes here, powering the admin
 * "DB Technology Monitor" live panel.
 */
const dbEventSchema = new mongoose.Schema(
  {
    paradigm: {
      type: String,
      enum: ['mongodb', 'graph', 'temporal', 'active', 'spatial'],
      required: true,
    },
    type: { type: String, required: true }, // e.g. 'eca.rule.fired', 'cron.overdue', 'change.stream'
    message: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

dbEventSchema.index({ createdAt: -1 });

export default mongoose.model('DbEvent', dbEventSchema);

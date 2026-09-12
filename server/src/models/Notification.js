import mongoose from 'mongoose';

/** Notification — written by the Active DB layer (ECA rules / cron) or user actions. */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true }, // availability, transaction, overdue, report, system…
    title: { type: String, required: true },
    message: { type: String, default: '' },
    link: { type: String, default: '' }, // in-app route, e.g. /resources/:id
    read: { type: Boolean, default: false },
    meta: {
      paradigm: { type: String, enum: ['mongodb', 'graph', 'temporal', 'active', 'spatial'] },
      extra: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);

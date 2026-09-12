import mongoose from 'mongoose';

/**
 * Transaction — a deal between two students over a resource.
 * Feedstock for the Active DB layer (change streams + overdue cron) and
 * the temporal layer (lend/return cycles recorded as history versions).
 */
const transactionSchema = new mongoose.Schema(
  {
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    borrower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['sell', 'donate', 'exchange', 'lend'], required: true },
    price: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'completed', 'returned', 'overdue'],
      default: 'pending',
    },
    dueDate: { type: Date }, // required for lend deals (overdue cron)
    returnedAt: { type: Date },
    message: { type: String, default: '', maxlength: 400 },
  },
  { timestamps: true }
);

transactionSchema.index({ owner: 1, status: 1 });
transactionSchema.index({ borrower: 1, status: 1 });
transactionSchema.index({ status: 1, dueDate: 1 }); // overdue cron scan

export default mongoose.model('Transaction', transactionSchema);

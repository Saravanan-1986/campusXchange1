import mongoose from 'mongoose';

/** Review — ratings + comments for both marketplace resources and study materials. */
const reviewSchema = new mongoose.Schema(
  {
    targetType: { type: String, enum: ['resource', 'material'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', maxlength: 600 },
  },
  { timestamps: true }
);

reviewSchema.index({ targetType: 1, targetId: 1, user: 1 }, { unique: true });

/** Recompute denormalized aggregates on the parent (Resource or StudyMaterial). */
reviewSchema.statics.syncAggregates = async function (targetType, targetId) {
  const [agg] = await this.aggregate([
    { $match: { targetType, targetId: new mongoose.Types.ObjectId(targetId) } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const update = { ratingAvg: agg ? Math.round(agg.avg * 10) / 10 : 0, ratingCount: agg ? agg.count : 0 };
  const Model = targetType === 'resource'
    ? mongoose.model('Resource')
    : mongoose.model('StudyMaterial');
  await Model.updateOne({ _id: targetId }, update);
  return update;
};

export default mongoose.model('Review', reviewSchema);

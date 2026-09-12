import mongoose from 'mongoose';

/**
 * Resource — physical marketplace item (textbooks, calculators, lab kits, tools…).
 * MongoDB document store. Also feeds the temporal layer (ResourceHistory snapshots),
 * the graph layer (Neo4j sync) and the spatial layer (2dsphere).
 */
const resourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    category: {
      type: String,
      enum: ['textbook', 'calculator', 'lab-kit', 'tool', 'electronic-component', 'project-resource', 'other'],
      required: true,
    },
    subject: { type: String, default: '' },
    department: { type: String, default: '' },
    semester: { type: Number, min: 1, max: 10 },
    condition: { type: String, enum: ['new', 'like-new', 'good', 'fair'], default: 'good' },
    listingType: { type: String, enum: ['sell', 'donate', 'exchange', 'lend'], default: 'sell' },
    price: { type: Number, default: 0, min: 0 },
    availability: {
      type: String,
      enum: ['available', 'unavailable', 'lent', 'reserved', 'flagged'],
      default: 'available',
    },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    images: [{ type: String }], // uploaded filenames served from /uploads
    tags: [{ type: String, lowercase: true }],
    // SPATIAL paradigm — geospatial point + 2dsphere index
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
      label: { type: String, default: '' },
    },
    // Review aggregates (denormalized from Review collection)
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    reportsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

resourceSchema.index({ location: '2dsphere' }); // SPATIAL paradigm: $near / $geoWithin
resourceSchema.index({ title: 'text', description: 'text', tags: 'text' });
resourceSchema.index({ category: 1, availability: 1, price: 1 });

export default mongoose.model('Resource', resourceSchema);

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
    /**
     * LISTING STATE — an item can be owned yet deliberately kept OFF the
     * marketplace: pulled from the listing by its owner, or received from
     * another student and not re-listed yet ("Items received").
     */
    isListed: { type: Boolean, default: true },
    /**
     * HANDOVER CHAIN — the item keeps its identity when it changes hands, so
     * the receiver is recorded here and the full chain of previous users lives
     * in PostgreSQL (custody_period valid-time periods + cx_custody_chain()).
     */
    receivedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },
    receivedVia: { type: String, enum: ['sell', 'donate', 'exchange', null], default: null },
    transferCount: { type: Number, default: 0 },
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
resourceSchema.index({ ownerId: 1, isListed: 1, createdAt: -1 }); // My Items
resourceSchema.index({ ownerId: 1, receivedFrom: 1 });           // Items received

export default mongoose.model('Resource', resourceSchema);

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User — MongoDB document store.
 * Geospatial: `location` is a GeoJSON Point with a 2dsphere index (spatial paradigm).
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    collegeEmail: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    verified: { type: Boolean, default: false },
    verifyToken: { type: String, select: false },
    department: { type: String, default: '' },
    semester: { type: Number, min: 1, max: 10, default: 1 },
    gradYear: { type: String, default: '' },
    bio: { type: String, maxlength: 240, default: '' },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
      label: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

userSchema.index({ location: '2dsphere' }); // SPATIAL paradigm

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model('User', userSchema);

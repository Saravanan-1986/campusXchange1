import mongoose from 'mongoose';

/**
 * StudyMaterial — Knowledge Hub documents (notes, question papers, lab manuals…).
 * Organized by department → semester → subject → category (browse hierarchy).
 */
const studyMaterialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    type: {
      type: String,
      enum: ['notes', 'question-paper', 'lab-manual', 'project-reference', 'other'],
      default: 'notes',
    },
    department: { type: String, default: '' },
    semester: { type: Number, min: 1, max: 10 },
    subject: { type: String, default: '' },
    description: { type: String, default: '', maxlength: 1200 },
    file: {
      filename: { type: String, required: true }, // served from /uploads/<filename>
      originalName: { type: String },
      mimeType: { type: String },
      size: { type: Number },
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    downloads: { type: Number, default: 0 },
    ratingAvg: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    reportsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

studyMaterialSchema.index({ department: 1, semester: 1, subject: 1, type: 1 });
studyMaterialSchema.index({ title: 'text', description: 'text' });

export default mongoose.model('StudyMaterial', studyMaterialSchema);

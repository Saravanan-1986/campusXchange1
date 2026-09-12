import express from 'express';
import StudyMaterial from '../models/StudyMaterial.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { logDbEvent } from '../services/eventlog.service.js';

/** Knowledge Hub — upload/browse notes, question papers, lab manuals (Multer + Mongo). */
const router = express.Router();

// Browse: dept → sem → subject → type + text search
router.get('/', async (req, res, next) => {
  try {
    const { department, semester, subject, type, q } = req.query;
    const filter = {};
    if (department) filter.department = department;
    if (semester) filter.semester = Number(semester);
    if (subject) filter.subject = subject;
    if (type) filter.type = type;
    if (q) filter.$text = { $search: q };
    const materials = await StudyMaterial.find(filter)
      .populate('uploadedBy', 'name department')
      .sort({ createdAt: -1 }).limit(100).lean();
    // Facets for the browse tree (distinct values, Mongo aggregation)
    const facets = await StudyMaterial.aggregate([
      { $group: { _id: '$department', subjects: { $addToSet: '$subject' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    res.json({ materials, facets });
  } catch (err) { next(err); }
});

// Upload (auth) — single PDF/image
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'file is required' });
    const { title, type, department, semester, subject, description } = req.body;
    const material = await StudyMaterial.create({
      title, type, department, semester: semester ? Number(semester) : undefined, subject, description,
      file: { filename: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size },
      uploadedBy: req.user._id,
    });
    await logDbEvent('mongodb', 'material.uploaded', `${req.user.name} uploaded "${title}"`, { id: String(material._id) });
    res.status(201).json({ material });
  } catch (err) { next(err); }
});

// Detail
router.get('/:id', async (req, res, next) => {
  try {
    const material = await StudyMaterial.findById(req.params.id).populate('uploadedBy', 'name department');
    if (!material) return res.status(404).json({ message: 'Material not found' });
    res.json({ material });
  } catch (err) { next(err); }
});

// Download / open (increments counter)
router.get('/:id/download', async (req, res, next) => {
  try {
    const material = await StudyMaterial.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });
    await StudyMaterial.updateOne({ _id: material._id }, { $inc: { downloads: 1 } });
    const p = path.resolve(env.uploadDir, material.file.filename);
    if (fs.existsSync(p)) return res.download(p, material.file.originalName || material.file.filename);
    res.status(404).json({ message: 'File missing on disk' });
  } catch (err) { next(err); }
});

// Delete (owner or admin)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const material = await StudyMaterial.findById(req.params.id);
    if (!material) return res.status(404).json({ message: 'Material not found' });
    if (String(material.uploadedBy) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not your upload' });
    }
    const p = path.resolve(env.uploadDir, material.file.filename);
    fs.existsSync(p) && fs.unlinkSync(p);
    await material.deleteOne();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

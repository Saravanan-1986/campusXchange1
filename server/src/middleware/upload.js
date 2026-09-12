import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { env } from '../config/env.js';

/** Multer local storage for resource images (multi) and knowledge-hub PDFs (single). */
const uploadRoot = path.resolve(env.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(8).toString('hex')}-${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const okTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  if (!okTypes.includes(file.mimetype)) return cb(new Error('Only PDF/PNG/JPG/WEBP files are allowed'));
  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
});

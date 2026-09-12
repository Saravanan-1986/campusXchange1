import dotenv from 'dotenv';
dotenv.config();

/**
 * Central env config (server).
 * Every value can be overridden in server/.env — see .env.example.
 */
export const env = {
  port: parseInt(process.env.PORT || '5001', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusxchange',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'campusxchange-dev-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'campusxchange',
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '10', 10),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@campusxchange.edu',
  collegeEmailDomains: (process.env.COLLEGE_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  reportAutoFlagThreshold: parseInt(process.env.REPORT_AUTOFLAG_THRESHOLD || '3', 10),
  isDev: process.env.NODE_ENV !== 'production',
};

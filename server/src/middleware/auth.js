import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { env } from '../config/env.js';

/** Sign a JWT for auth/session. */
export function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpires });
}

/** Require a valid Bearer token. Attaches req.user (full User doc). */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const decoded = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'User no longer exists' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/** Role guard — usage: router.get('/x', requireAuth, requireRole('admin'), handler) */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

/** College email gate: .edu / .edu.in / .ac.in or admin-configured extra domains. */
export function isCollegeEmail(email) {
  const e = (email || '').toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.(edu|edu\.in|ac\.in)$/.test(e)) return true;
  return env.collegeEmailDomains.some((d) => e.endsWith(`@${d}`) || e.endsWith(`.${d}`));
}

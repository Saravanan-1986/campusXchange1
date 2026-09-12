import crypto from 'crypto';
import express from 'express';
import User from '../models/User.js';
import { signToken, requireAuth, isCollegeEmail } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * Auth routes — JWT auth + college-email verification (dev mailer stub logs
 * the verification link to the console; the register response also returns a
 * devToken shortcut so demos don't need an SMTP server).
 */
const router = express.Router();

function publicUser(u) {
  return {
    id: u._id, name: u.name, collegeEmail: u.collegeEmail, role: u.role,
    verified: u.verified, department: u.department, semester: u.semester,
    gradYear: u.gradYear, bio: u.bio,
    location: u.location, createdAt: u.createdAt,
  };
}

// REGISTER
router.post('/register', async (req, res, next) => {
  try {
    const { name, collegeEmail, password, department, semester, gradYear } = req.body;
    if (!name || !collegeEmail || !password) return res.status(400).json({ message: 'All fields are required' });
    if (!isCollegeEmail(collegeEmail)) {
      return res.status(400).json({ message: 'Only college emails (.edu / .ac.in) can register' });
    }
    const exists = await User.findOne({ collegeEmail: collegeEmail.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'This email is already registered' });

    const verifyToken = crypto.randomBytes(24).toString('hex');
    const user = await User.create({
      name, collegeEmail, password, department, semester,
      gradYear,
      verifyToken,
      // Bootstrap admin: first user with the configured ADMIN_EMAIL becomes admin
      role: collegeEmail.toLowerCase() === env.adminEmail.toLowerCase() ? 'admin' : 'student',
    });

    const verifyUrl = `${env.clientUrl}/verify?token=${verifyToken}`;
    console.log(`\n[auth] ✉  Dev verification link for ${user.collegeEmail}:\n       ${verifyUrl}\n`);

    res.status(201).json({
      user: publicUser(user),
      token: signToken(user),
      devToken: env.isDev ? verifyToken : undefined, // dev shortcut only
    });
  } catch (err) { next(err); }
});

// LOGIN
router.post('/login', async (req, res, next) => {
  try {
    const { collegeEmail, password } = req.body;
    const user = await User.findOne({ collegeEmail: (collegeEmail || '').toLowerCase() }).select('+password');
    if (!user || !(await user.matchPassword(password || ''))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    res.json({ user: publicUser(user), token: signToken(user) });
  } catch (err) { next(err); }
});

// VERIFY COLLEGE EMAIL
router.post('/verify', async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await User.findOne({ verifyToken: token }).select('+verifyToken');
    if (!user) return res.status(400).json({ message: 'Invalid or expired verification token' });
    user.verified = true;
    user.verifyToken = undefined;
    await user.save();
    await logDbEvent('mongodb', 'auth.verified', `${user.name} verified their college email`);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

// RESEND VERIFICATION
router.post('/resend-verification', requireAuth, async (req, res, next) => {
  try {
    const token = crypto.randomBytes(24).toString('hex');
    req.user.verifyToken = token;
    await req.user.save();
    const verifyUrl = `${env.clientUrl}/verify?token=${token}`;
    console.log(`\n[auth] ✉  Dev verification link:\n       ${verifyUrl}\n`);
    res.json({ ok: true, devToken: env.isDev ? token : undefined });
  } catch (err) { next(err); }
});

// ME
router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;

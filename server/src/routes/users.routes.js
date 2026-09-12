import express from 'express';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

/** Users — profile CRUD + geolocation capture (spatial paradigm). */
const router = express.Router();

function publicUser(u) {
  return {
    id: u._id, name: u.name, collegeEmail: u.collegeEmail, role: u.role,
    verified: u.verified, department: u.department, semester: u.semester,
    gradYear: u.gradYear, bio: u.bio, location: u.location, createdAt: u.createdAt,
  };
}

// Update own profile (incl. location pin for "Near Me")
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const allowed = ['name', 'department', 'semester', 'gradYear', 'bio'];
    allowed.forEach((f) => { if (req.body[f] !== undefined) req.user[f] = req.body[f]; });
    if (req.body.location) {
      const { coordinates, label } = req.body.location;
      const [lng, lat] = coordinates || [];
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        req.user.location = { type: 'Point', coordinates: [lng, lat], label: label || '' };
      }
    }
    await req.user.save();
    await req.user.updateOne({ $unset: { verifyToken: 1 } }); // cleanup noise
    res.json({ user: publicUser(req.user) });
  } catch (err) { next(err); }
});

// Public profile
router.get('/:id', async (req, res, next) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: 'User not found' });
    res.json({
      user: {
        id: u._id, name: u.name, department: u.department, semester: u.semester,
        gradYear: u.gradYear, bio: u.bio, createdAt: u.createdAt,
        location: u.location, // coordinates shown publicly; identity is name + department
      },
    });
  } catch (err) { next(err); }
});

export default router;

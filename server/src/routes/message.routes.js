import express from 'express';
import mongoose from 'mongoose';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Resource from '../models/Resource.js';
import { requireAuth } from '../middleware/auth.js';
import { openThread, sendThreadMessage } from '../services/chat.service.js';
import { emitToUser } from '../sockets/index.js';
import { notify } from '../services/notification.service.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * Messaging — student ↔ student chat (MongoDB documents + Socket.io transport).
 * Keyed by pairKey (sorted user IDs) to ensure 1:1 conversation uniqueness.
 */
const router = express.Router();

const pairKeyOf = (a, b) => [String(a), String(b)].sort().join('::');

// GET /api/messages/conversations — my threads with unread counters
router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'name department semester')
      .populate('resource', 'title images price')
      .sort({ lastMessageAt: -1 })
      .limit(60)
      .lean();
    const shaped = conversations.map((c) => ({
      ...c,
      peer: c.participants.find((p) => String(p._id) !== String(req.user._id)) || null,
      unread: Number(c.unread?.[String(req.user._id)] || 0),
    }));
    const unreadTotal = shaped.reduce((sum, c) => sum + c.unread, 0);
    res.json({ conversations: shaped, unreadTotal });
  } catch (err) { next(err); }
});

// POST /api/messages/conversations — open (or reuse) a thread
router.post('/conversations', requireAuth, async (req, res, next) => {
  try {
    const { peerId, resourceId = null, subject = '' } = req.body;
    if (!mongoose.isValidObjectId(peerId)) return res.status(400).json({ message: 'peerId is required' });
    if (String(peerId) === String(req.user._id)) return res.status(400).json({ message: "You can't message yourself" });

    const peer = await User.findById(peerId);
    if (!peer) return res.status(404).json({ message: 'User not found' });

    const pairKey = pairKeyOf(req.user._id, peerId);
    let conversation = await Conversation.findOne({ pairKey });
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, peer._id],
        pairKey,
        resource: resourceId && mongoose.isValidObjectId(resourceId) ? resourceId : null,
        subject: subject || '',
        unread: {},
      });
      await logDbEvent('mongodb', 'chat.opened', `${req.user.name} opened a thread with ${peer.name}`, {});
    }
    res.status(201).json({ conversation });
  } catch (err) { next(err); }
});

// GET /api/messages/conversations/:id — thread messages (clears unread)
router.get('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id });
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    const messages = await Message.find({ conversation: conversation._id })
      .populate('sender', 'name')
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 60)
      .lean();

    conversation.unread = conversation.unread || new Map();
    conversation.unread.set(String(req.user._id), 0);
    await conversation.save();
    await Message.updateMany(
      { conversation: conversation._id, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    const peer = await User.findById(conversation.participants.find((p) => String(p) !== String(req.user._id)))
      .select('name department semester');

    res.json({ conversation, messages: messages.reverse(), peer });
  } catch (err) { next(err); }
});
// POST /api/messages/conversations/:id — send a message
router.post('/conversations/:id', requireAuth, async (req, res, next) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ message: 'Message body is required' });

    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id })
      .populate('resource', 'title');
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    const peerId = conversation.participants.find((p) => String(p) !== String(req.user._id));
    const message = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      body,
      readBy: [req.user._id],
    });

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = body.slice(0, 90);
    conversation.lastSender = req.user._id;
    conversation.unread = conversation.unread || new Map();
    conversation.unread.set(String(peerId), Number(conversation.unread.get(String(peerId)) || 0) + 1);
    await conversation.save();

    const payload = {
      ...message.toObject(),
      sender: { _id: req.user._id, name: req.user.name },
      conversationId: String(conversation._id),
      peerId: String(peerId),
      peerName: req.user.name,
      resourceTitle: conversation.resource?.title || '',
    };
    emitToUser(String(peerId), 'message:new', payload);

    await notify({
      user: peerId,
      type: 'message',
      title: `💬 ${req.user.name}`,
      message: conversation.resource?.title ? `${conversation.resource.title}: ${body.slice(0, 70)}` : body.slice(0, 90),
      link: '/chat',
      paradigm: 'mongodb',
      extra: { conversationId: String(conversation._id) },
    });

    res.status(201).json({ message, conversation: { _id: conversation._id, lastMessageAt: conversation.lastMessageAt } });
  } catch (err) { next(err); }
});

// POST /api/messages/quick — start a thread from a listing page
router.post('/quick', requireAuth, async (req, res, next) => {
  try {
    const { resourceId, body = '' } = req.body;
    if (!mongoose.isValidObjectId(resourceId)) return res.status(400).json({ message: 'resourceId is required' });
    const resource = await Resource.findById(resourceId).populate('ownerId', 'name');
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    if (String(resource.ownerId._id) === String(req.user._id)) {
      return res.status(400).json({ message: 'You own this listing' });
    }

    const pairKey = pairKeyOf(req.user._id, resource.ownerId._id);
    let conversation = await Conversation.findOne({ pairKey });
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [req.user._id, resource.ownerId._id],
        pairKey,
        resource: resource._id,
        subject: resource.title,
        unread: {},
      });
    }

    const text = String(body || '').trim() || `Hi! Is "${resource.title}" still available?`;
    const message = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      body: text,
      readBy: [req.user._id],
    });

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = text.slice(0, 90);
    conversation.lastSender = req.user._id;
    conversation.unread = conversation.unread || new Map();
    conversation.unread.set(String(resource.ownerId._id), Number(conversation.unread.get(String(resource.ownerId._id)) || 0) + 1);
    await conversation.save();

    emitToUser(String(resource.ownerId._id), 'message:new', {
      ...message.toObject(),
      sender: { _id: req.user._id, name: req.user.name },
      conversationId: String(conversation._id),
      peerName: req.user.name,
      resourceTitle: resource.title,
    });
    await logDbEvent('mongodb', 'chat.message', `${req.user.name} → ${resource.ownerId.name} about "${resource.title}"`, {});

    res.status(201).json({ conversationId: conversation._id, message });
  } catch (err) { next(err); }
});

export default router;


import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { emitToUser } from '../sockets/index.js';
import { notify } from '../services/notification.service.js';

/**
 * Open (or reuse) a 1:1 thread keyed by pairKey so buyer↔seller chat is unique.
 * Optionally anchor it to a listing (`resourceId`) and/or a deal
 * (`transactionId`); returns the conversation document.
 */
export async function openThread({ meId, peerId, resourceId = null, transactionId = null, subject = '' }) {
  if (!peerId || String(peerId) === String(meId)) {
    const e = new Error("You can't message yourself");
    e.status = 400;
    throw e;
  }
  const pairKey = [String(meId), String(peerId)].sort().join('::');
  let conversation = await Conversation.findOne({ pairKey });
  if (!conversation) {
    conversation = await Conversation.create({
      participants: [meId, peerId],
      pairKey,
      resource: resourceId || null,
      transaction: transactionId || null,
      subject: subject || '',
      unread: {},
    });
  } else {
    // Keep the anchor fresh: latest interested listing + deal win.
    let dirty = false;
    if (resourceId && String(conversation.resource || '') !== String(resourceId)) {
      conversation.resource = resourceId;
      conversation.subject = subject || conversation.subject;
      dirty = true;
    }
    if (transactionId && String(conversation.transaction || '') !== String(transactionId)) {
      conversation.transaction = transactionId;
      dirty = true;
    }
    if (dirty) await conversation.save();
  }
  return conversation;
}

/** Append a bubble, bump unread + preview, push over socket.io + notification. */
export async function sendThreadMessage({ conversation, me, peerId, body, system = false }) {
  const text = String(body || '').trim();
  if (!text) {
    const e = new Error('Message is empty');
    e.status = 400;
    throw e;
  }
  const message = await Message.create({
    conversation: conversation._id,
    sender: me._id,
    body: text.slice(0, 1200),
    readBy: [me._id],
    system,
  });

  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = text.slice(0, 90);
  conversation.lastSender = me._id;
  conversation.unread = conversation.unread || new Map();
  conversation.unread.set(String(peerId), Number(conversation.unread.get(String(peerId)) || 0) + 1);
  await conversation.save();

  const peerName = me.name;
  emitToUser(String(peerId), 'message:new', {
    ...message.toObject(),
    sender: { _id: me._id, name: peerName },
    conversationId: String(conversation._id),
    peerId: String(me._id),
    peerName,
    resourceTitle: conversation.subject || '',
  });

  await notify({
    user: peerId,
    type: 'message',
    title: `💬 ${peerName}`,
    message: text.slice(0, 90),
    link: `/messages?c=${conversation._id}`,
    paradigm: 'mongodb',
    extra: { conversationId: String(conversation._id) },
  });

  return { message, conversation };
}

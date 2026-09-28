import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { emitToUser } from '../sockets/index.js';
import { notify } from '../services/notification.service.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * SLASH COMMANDS in the chat window — the handover control surface.
 *
 *   /donate            → give the item to the student in this chat (free)
 *   /sell 250          → sell it to them for ₹250 (price optional)
 *   /remove            → pull the listing off the marketplace, keep it
 *
 * Only the item's owner may run them. The command performs the cross-database
 * handover (see services/transfer.service.js), then posts a SYSTEM bubble so
 * both sides see exactly what happened.
 */
export const CHAT_COMMANDS = ['donate', 'sell', 'remove'];

export const COMMAND_HELP = [
  { command: '/donate', label: 'Donate this item', hint: 'Give it to the student in this chat for free' },
  { command: '/sell', label: 'Sell this item', hint: 'Sell it here — /sell 250 sets the price' },
  { command: '/remove', label: 'Remove from marketplace', hint: 'Take the listing down, keep the item' },
];

/** Parse "/sell 250" → { command: 'sell', price: 250 }. Returns null if not a command. */
export function parseChatCommand(text) {
  const match = String(text || '').trim().match(/^\/(donate|sell|remove)\b\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)?/i);
  if (!match) return null;
  return {
    command: match[1].toLowerCase(),
    price: match[2] !== undefined && match[2] !== '' ? Number(match[2]) : null,
  };
}

/** Peer-facing bubble written by the server (rendered as a system line). */
export async function pushSystemMessage({ conversation, me, peerId, body }) {
  const text = String(body || '').trim();
  if (!text) return null;
  const message = await Message.create({
    conversation: conversation._id,
    sender: me._id,
    body: text.slice(0, 1200),
    readBy: [me._id],
    system: true,
  });

  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = text.slice(0, 90);
  conversation.lastSender = me._id;
  conversation.unread = conversation.unread || new Map();
  conversation.unread.set(String(peerId), Number(conversation.unread.get(String(peerId)) || 0) + 1);
  await conversation.save();

  emitToUser(String(peerId), 'message:new', {
    ...message.toObject(),
    sender: { _id: me._id, name: me.name },
    conversationId: String(conversation._id),
    peerId: String(me._id),
    peerName: me.name,
    resourceTitle: conversation.subject || '',
  });
  return message;
}

/**
 * Run a chat slash command: hand the item over (/donate, /sell) or take the
 * listing down (/remove), then post the system bubble. Returns the summary so
 * the HTTP route can answer with something the UI can toast.
 */
export async function runChatCommand({ conversation, me, peerId, command, price = null }) {
  const resource = conversation.resource;
  if (!resource || !resource._id) {
    const e = new Error('This conversation is not linked to a listing anymore');
    e.status = 400;
    throw e;
  }
  const { transferResource, unlistResource, isOwnerOrAdmin } = await import('./transfer.service.js');
  if (!isOwnerOrAdmin(resource, me)) {
    const e = new Error(`Only the owner of "${resource.title}" can use /${command}`);
    e.status = 403;
    throw e;
  }

  const chatRef = String(conversation._id).slice(-6);
  let summary;
  let outcome;

  if (command === 'remove') {
    const { resource: updated, alreadyUnlisted } = await unlistResource({
      resourceId: resource._id,
      actor: me,
      note: `Removed from the marketplace from chat #${chatRef}`,
    });
    summary = alreadyUnlisted
      ? `ℹ️ "${updated.title}" was already off the marketplace — nothing to do.`
      : `🗑 ${me.name} removed "${updated.title}" from the marketplace. It was not handed to anyone.`;
    outcome = { mode: 'remove', resourceId: String(updated._id), title: updated.title, price: 0 };
  } else {
    const result = await transferResource({
      resourceId: resource._id,
      toUserId: peerId,
      mode: command,
      price,
      actor: me,
      conversationId: conversation._id,
      note: `${command === 'donate' ? 'Donation' : 'Sale'} completed in chat #${chatRef}`,
    });
    summary = command === 'donate'
      ? `🎁 ${me.name} donated "${result.resource.title}" to the receiver. It is off the marketplace and now lives in their Items received.`
      : `🤝 ${me.name} sold "${result.resource.title}" for ₹${result.price}. It is off the marketplace and now lives in the receiver's Items received.`;
    outcome = {
      mode: command,
      resourceId: String(result.resource._id),
      title: result.resource.title,
      price: result.price,
      transferCount: result.resource.transferCount,
    };
  }

  const message = await pushSystemMessage({ conversation, me, peerId: String(peerId), body: summary });
  await logDbEvent('graph', 'chat.command', `/${command} in chat #${chatRef} → ${outcome.title}`, outcome);
  return { command, summary, outcome, message };
}

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

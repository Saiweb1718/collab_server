import { Server } from 'socket.io';
import { extractToken, verifyToken } from '../middlewares/auth.middlewares.js';
import {
  isChatMember,
  saveMessage,
  markChatRead,
  getChatMemberIds,
  editMessage,
  deleteMessage,
} from './chat.service.js';

let io;

// userId -> number of live sockets (a user may have several tabs open)
const presence = new Map();

const roomForChat = (chatId) => `chat:${chatId}`;
const roomForUser = (userId) => `user:${userId}`;

const setOnline = (userId) => {
  const next = (presence.get(userId) || 0) + 1;
  presence.set(userId, next);
  return next === 1; // became online
};
const setOffline = (userId) => {
  const next = (presence.get(userId) || 1) - 1;
  if (next <= 0) {
    presence.delete(userId);
    return true; // went offline
  }
  presence.set(userId, next);
  return false;
};

export function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || true,
      credentials: true,
    },
  });

  // ---- Authentication handshake ----
  io.use((socket, next) => {
    try {
      const token = extractToken({
        cookieHeader: socket.handshake.headers?.cookie,
        authHeader: socket.handshake.headers?.authorization,
        authToken: socket.handshake.auth?.token,
      });
      if (!token) return next(new Error('Authentication required'));
      const decoded = verifyToken(token);
      socket.userId = decoded.userId;
      socket.userName = decoded.name;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket;
    socket.join(roomForUser(userId));

    if (setOnline(userId)) {
      socket.broadcast.emit('presence:update', { userId, online: true });
    }
    // tell the newcomer who is currently online
    socket.emit('presence:list', { online: [...presence.keys()] });

    // ---- Join a chat room (membership enforced) ----
    socket.on('chat:join', async ({ chatId }, ack) => {
      try {
        if (!(await isChatMember(chatId, userId))) throw new Error('Not a member');
        socket.join(roomForChat(chatId));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('chat:leave', ({ chatId }) => {
      socket.leave(roomForChat(chatId));
    });

    // ---- Send a message ----
    socket.on('message:send', async ({ chatId, text, fileUrl, type, tempId, mentionIds }, ack) => {
      try {
        if (!(await isChatMember(chatId, userId))) throw new Error('Not a member of this chat');

        const message = await saveMessage({ chatId, senderId: userId, text, fileUrl, type, mentionIds });

        // Broadcast to everyone currently viewing the chat.
        io.to(roomForChat(chatId)).emit('message:new', { ...message, tempId });

        // Nudge every member's personal room so their chat list updates / badges.
        const memberIds = await getChatMemberIds(chatId);
        for (const mid of memberIds) {
          io.to(roomForUser(mid)).emit('chat:updated', { chatId, message });
        }

        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({ ok: false, error: err.message, tempId });
      }
    });

    // ---- Edit a message ----
    socket.on('message:edit', async ({ messageId, text }, ack) => {
      try {
        const message = await editMessage({ messageId, userId, text });
        io.to(roomForChat(message.message_chat_id)).emit('message:updated', message);
        ack?.({ ok: true, message });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // ---- Delete a message (soft) ----
    socket.on('message:delete', async ({ messageId }, ack) => {
      try {
        const result = await deleteMessage({ messageId, userId });
        io.to(roomForChat(result.message_chat_id)).emit('message:deleted', result);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // ---- Read receipts ----
    socket.on('message:read', async ({ chatId }) => {
      try {
        if (!(await isChatMember(chatId, userId))) return;
        await markChatRead(chatId, userId);
        socket.to(roomForChat(chatId)).emit('message:read', { chatId, userId });
      } catch {
        /* ignore */
      }
    });

    // ---- Typing indicators ----
    socket.on('typing:start', ({ chatId }) => {
      socket.to(roomForChat(chatId)).emit('typing', {
        chatId,
        userId,
        userName: socket.userName,
        isTyping: true,
      });
    });
    socket.on('typing:stop', ({ chatId }) => {
      socket.to(roomForChat(chatId)).emit('typing', {
        chatId,
        userId,
        userName: socket.userName,
        isTyping: false,
      });
    });

    socket.on('disconnect', () => {
      if (setOffline(userId)) {
        socket.broadcast.emit('presence:update', { userId, online: false });
      }
    });
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

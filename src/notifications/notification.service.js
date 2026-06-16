import { query } from '../db/index.js';
import { getIO } from '../chat/socket.js';

const roomForUser = (userId) => `user:${userId}`;

/**
 * Insert a notification and push it live to the recipient's socket room.
 * Never throws into the caller's main flow (notifications are best-effort).
 */
export const createNotification = async ({
  userId,
  sourceUserId = null,
  type,
  entityType = null,
  entityId = null,
  message,
}) => {
  try {
    if (userId === sourceUserId) return null; // don't notify yourself
    const { rows } = await query(
      `INSERT INTO notifications
         (notification_user_id, notification_source_user_id, notification_type,
          notification_entity_type, notification_entity_id, notification_message)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [userId, sourceUserId, type, entityType, entityId, message]
    );
    const notif = rows[0];
    try {
      getIO().to(roomForUser(userId)).emit('notification:new', notif);
    } catch {
      /* socket not ready — fine */
    }
    return notif;
  } catch (err) {
    console.error('createNotification failed:', err.message);
    return null;
  }
};

export const notifyMany = (recipients = [], base) =>
  Promise.all(recipients.map((userId) => createNotification({ ...base, userId })));

// Push an arbitrary realtime event to a single user's socket room (best-effort).
export const emitToUser = (userId, event, payload) => {
  try {
    getIO().to(roomForUser(userId)).emit(event, payload);
  } catch {
    /* socket not ready — fine */
  }
};

import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { createNotification } from '../notifications/notification.service.js';

export const isChatMember = async (chatId, userId) => {
  const { rowCount } = await query(
    'SELECT 1 FROM chat_members WHERE chat_member_chat_id = $1 AND chat_member_user_id = $2',
    [chatId, userId]
  );
  return rowCount > 0;
};

export const getChatMemberIds = async (chatId) => {
  const { rows } = await query(
    'SELECT chat_member_user_id FROM chat_members WHERE chat_member_chat_id = $1',
    [chatId]
  );
  return rows.map((r) => r.chat_member_user_id);
};

// A human label for a chat (used in notifications).
const getChatTitle = async (chatId) => {
  const { rows } = await query(
    `SELECT COALESCE(p.project_name, cl.cluster_name, 'a conversation') AS title
       FROM chats ch
       LEFT JOIN projects p ON p.project_chat_id = ch.chat_id
       LEFT JOIN clusters cl ON cl.cluster_company_chat_id = ch.chat_id
      WHERE ch.chat_id = $1`,
    [chatId]
  );
  return rows[0]?.title || 'a conversation';
};

// Lightweight single-COUNT total unread (for the nav badge) — much cheaper
// than getUserChats with all its lateral joins.
export const getTotalUnread = async (userId) => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM messages m
       JOIN chat_members cm ON cm.chat_member_chat_id = m.message_chat_id AND cm.chat_member_user_id = $1
       LEFT JOIN message_read_receipts r ON r.receipt_message_id = m.message_id AND r.receipt_user_id = $1
      WHERE m.message_from_user_id <> $1 AND m.message_is_deleted = FALSE AND r.receipt_read_at IS NULL`,
    [userId]
  );
  return rows[0].count;
};

export const getUserChats = async (userId) => {
  const { rows } = await query(
    `
    SELECT ch.chat_id, ch.chat_type, ch.chat_updated_at,
      CASE ch.chat_type
        WHEN 'project' THEN p.project_name
        WHEN 'company' THEN cl.cluster_name
        WHEN 'direct'  THEN other.user_name
      END AS title,
      other.user_id AS direct_user_id,
      other.user_avatar_url AS direct_avatar_url,
      lm.message_text AS last_message_text,
      lm.message_time AS last_message_time,
      lm.message_type AS last_message_type,
      lm.message_is_deleted AS last_message_deleted,
      (SELECT COUNT(*)::int FROM messages m
        LEFT JOIN message_read_receipts r
          ON r.receipt_message_id = m.message_id AND r.receipt_user_id = $1
        WHERE m.message_chat_id = ch.chat_id AND m.message_from_user_id <> $1
          AND m.message_is_deleted = FALSE AND r.receipt_read_at IS NULL) AS unread_count
    FROM chat_members cm
    JOIN chats ch ON ch.chat_id = cm.chat_member_chat_id
    LEFT JOIN projects p ON p.project_chat_id = ch.chat_id
    LEFT JOIN clusters cl ON cl.cluster_company_chat_id = ch.chat_id
    LEFT JOIN LATERAL (
      SELECT u.user_id, u.user_name, u.user_avatar_url
      FROM chat_members cm2 JOIN users u ON u.user_id = cm2.chat_member_user_id
      WHERE cm2.chat_member_chat_id = ch.chat_id AND cm2.chat_member_user_id <> $1 LIMIT 1
    ) other ON ch.chat_type = 'direct'
    LEFT JOIN LATERAL (
      SELECT message_text, message_time, message_type, message_is_deleted
      FROM messages m WHERE m.message_chat_id = ch.chat_id
      ORDER BY m.message_time DESC LIMIT 1
    ) lm ON TRUE
    WHERE cm.chat_member_user_id = $1
    ORDER BY COALESCE(lm.message_time, ch.chat_updated_at) DESC
    `,
    [userId]
  );
  return rows;
};

const MESSAGE_SELECT = `
  m.message_id, m.message_chat_id,
  CASE WHEN m.message_is_deleted THEN NULL ELSE m.message_text END AS message_text,
  CASE WHEN m.message_is_deleted THEN NULL ELSE m.message_file_url END AS message_file_url,
  m.message_type, m.message_time, m.message_is_deleted, m.message_is_edited,
  u.user_id AS sender_id, u.user_name AS sender_name, u.user_avatar_url AS sender_avatar,
  COALESCE((SELECT json_agg(mm.mention_user_id) FROM message_mentions mm WHERE mm.mention_message_id = m.message_id), '[]') AS mentions,
  EXISTS (SELECT 1 FROM message_read_receipts r
           WHERE r.receipt_message_id = m.message_id
             AND r.receipt_user_id <> m.message_from_user_id
             AND r.receipt_read_at IS NOT NULL) AS seen`;

export const getMessages = async (chatId, { limit = 50, before } = {}) => {
  const params = [chatId, Math.min(limit, 100)];
  let beforeClause = '';
  if (before) {
    params.push(before);
    beforeClause = 'AND m.message_time < $3';
  }
  const { rows } = await query(
    `SELECT ${MESSAGE_SELECT}
       FROM messages m JOIN users u ON u.user_id = m.message_from_user_id
      WHERE m.message_chat_id = $1 ${beforeClause}
      ORDER BY m.message_time DESC LIMIT $2`,
    params
  );
  return rows.reverse();
};

const hydrate = async (messageId) => {
  const { rows } = await query(
    `SELECT ${MESSAGE_SELECT}
       FROM messages m JOIN users u ON u.user_id = m.message_from_user_id
      WHERE m.message_id = $1`,
    [messageId]
  );
  return rows[0];
};

export const saveMessage = async ({ chatId, senderId, text, fileUrl = null, type = 'text', mentionIds = [] }) => {
  if (!text?.trim() && !fileUrl) throw new ApiError(400, 'Message cannot be empty');

  const messageId = await withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO messages (message_chat_id, message_from_user_id, message_text, message_file_url, message_type)
       VALUES ($1,$2,$3,$4,$5) RETURNING message_id`,
      [chatId, senderId, text?.trim() ?? null, fileUrl, type]
    );
    const id = ins.rows[0].message_id;
    const valid = [...new Set(mentionIds)].filter((x) => x && x !== senderId);
    for (const uid of valid) {
      await client.query(
        `INSERT INTO message_mentions (mention_message_id, mention_user_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, uid]
      );
    }
    await client.query('UPDATE chats SET chat_updated_at = now() WHERE chat_id = $1', [chatId]);
    return id;
  });

  // mention notifications — fire-and-forget so message delivery isn't delayed
  const valid = [...new Set(mentionIds)].filter((x) => x && x !== senderId);
  if (valid.length) {
    (async () => {
      const title = await getChatTitle(chatId);
      const sender = await query('SELECT user_name FROM users WHERE user_id = $1', [senderId]);
      for (const uid of valid) {
        createNotification({
          userId: uid,
          sourceUserId: senderId,
          type: 'mention',
          entityType: 'chat',
          entityId: chatId,
          message: `${sender.rows[0]?.user_name || 'Someone'} mentioned you in ${title}`,
        });
      }
    })();
  }

  return hydrate(messageId);
};

export const editMessage = async ({ messageId, userId, text }) => {
  if (!text?.trim()) throw new ApiError(400, 'Message cannot be empty');
  const { rows } = await query(
    `UPDATE messages SET message_text = $1, message_is_edited = TRUE, message_updated_at = now()
      WHERE message_id = $2 AND message_from_user_id = $3 AND message_is_deleted = FALSE
      RETURNING message_id, message_chat_id`,
    [text.trim(), messageId, userId]
  );
  if (rows.length === 0) throw new ApiError(403, 'You can only edit your own messages');
  return hydrate(messageId);
};

export const deleteMessage = async ({ messageId, userId }) => {
  const { rows } = await query(
    `UPDATE messages SET message_is_deleted = TRUE, message_updated_at = now()
      WHERE message_id = $1 AND message_from_user_id = $2
      RETURNING message_id, message_chat_id`,
    [messageId, userId]
  );
  if (rows.length === 0) throw new ApiError(403, 'You can only delete your own messages');
  return { message_id: messageId, message_chat_id: rows[0].message_chat_id };
};

export const markChatRead = async (chatId, userId) => {
  await query(
    `INSERT INTO message_read_receipts (receipt_message_id, receipt_user_id, receipt_read_at)
     SELECT m.message_id, $2, now() FROM messages m
      WHERE m.message_chat_id = $1 AND m.message_from_user_id <> $2
     ON CONFLICT (receipt_message_id, receipt_user_id)
     DO UPDATE SET receipt_read_at = now()
     WHERE message_read_receipts.receipt_read_at IS NULL`,
    [chatId, userId]
  );
};

export const getOrCreateDirectChat = async (userId, otherUserId) => {
  if (userId === otherUserId) throw new ApiError(400, 'Cannot start a chat with yourself');
  const other = await query('SELECT 1 FROM users WHERE user_id = $1', [otherUserId]);
  if (other.rowCount === 0) throw new ApiError(404, 'User not found');

  const existing = await query(
    `SELECT c.chat_id FROM chats c
       JOIN chat_members a ON a.chat_member_chat_id = c.chat_id AND a.chat_member_user_id = $1
       JOIN chat_members b ON b.chat_member_chat_id = c.chat_id AND b.chat_member_user_id = $2
      WHERE c.chat_type = 'direct' LIMIT 1`,
    [userId, otherUserId]
  );
  if (existing.rowCount > 0) return existing.rows[0].chat_id;

  return withTransaction(async (client) => {
    const chat = await client.query(`INSERT INTO chats (chat_type) VALUES ('direct') RETURNING chat_id`);
    const chatId = chat.rows[0].chat_id;
    await client.query(
      `INSERT INTO chat_members (chat_member_chat_id, chat_member_user_id) VALUES ($1,$2),($1,$3)`,
      [chatId, userId, otherUserId]
    );
    return chatId;
  });
};

// Members of a chat (for mention autocomplete in the chat UI).
export const getChatMembersDetailed = async (chatId) => {
  const { rows } = await query(
    `SELECT u.user_id, u.user_name, u.user_avatar_url
       FROM chat_members cm JOIN users u ON u.user_id = cm.chat_member_user_id
      WHERE cm.chat_member_chat_id = $1 ORDER BY u.user_name`,
    [chatId]
  );
  return rows;
};

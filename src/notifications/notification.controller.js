import { query } from '../db/index.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const { rows } = await query(
    `SELECT n.*, u.user_name AS source_name, u.user_avatar_url AS source_avatar
       FROM notifications n
       LEFT JOIN users u ON u.user_id = n.notification_source_user_id
      WHERE n.notification_user_id = $1
      ORDER BY n.notification_created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

export const unreadCount = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM notifications
      WHERE notification_user_id = $1 AND notification_is_read = FALSE`,
    [req.user.userId]
  );
  return res.status(200).json(new ApiResponse(200, { count: rows[0].count }, 'OK'));
});

export const markRead = asyncHandler(async (req, res) => {
  await query(
    `UPDATE notifications SET notification_is_read = TRUE
      WHERE notification_id = $1 AND notification_user_id = $2`,
    [req.params.id, req.user.userId]
  );
  return res.status(200).json(new ApiResponse(200, null, 'OK'));
});

export const markAllRead = asyncHandler(async (req, res) => {
  await query(
    `UPDATE notifications SET notification_is_read = TRUE
      WHERE notification_user_id = $1 AND notification_is_read = FALSE`,
    [req.user.userId]
  );
  return res.status(200).json(new ApiResponse(200, null, 'OK'));
});

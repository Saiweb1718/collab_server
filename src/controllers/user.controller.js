import argon2 from 'argon2';
import { query } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const searchUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.status(200).json(new ApiResponse(200, [], 'OK'));
  const { rows } = await query(
    `SELECT user_id, user_name, user_email, user_avatar_url, user_title
       FROM users
      WHERE (user_name ILIKE $1 OR user_email ILIKE $1) AND user_id <> $2
      ORDER BY user_name LIMIT 10`,
    [`%${q}%`, req.user.userId]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

export const getProfile = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT user_id, user_name, user_email, user_avatar_url, user_title, user_bio, user_created_at
       FROM users WHERE user_id = $1`,
    [req.params.userId]
  );
  if (rows.length === 0) throw new ApiError(404, 'User not found');
  return res.status(200).json(new ApiResponse(200, rows[0], 'OK'));
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, title, bio, avatarUrl } = req.body;
  const fields = [];
  const values = [];
  let i = 1;
  const set = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Name cannot be empty');
    set('user_name', name.trim());
  }
  if (title !== undefined) set('user_title', title);
  if (bio !== undefined) set('user_bio', bio);
  if (avatarUrl !== undefined) set('user_avatar_url', avatarUrl);
  if (fields.length === 0) throw new ApiError(400, 'Nothing to update');

  values.push(req.user.userId);
  const { rows } = await query(
    `UPDATE users SET ${fields.join(', ')} WHERE user_id = $${i}
      RETURNING user_id, user_name, user_email, user_avatar_url, user_title, user_bio`,
    values
  );
  return res.status(200).json(new ApiResponse(200, rows[0], 'Profile updated'));
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw new ApiError(400, 'Both passwords are required');
  if (newPassword.length < 6) throw new ApiError(400, 'New password must be at least 6 characters');

  const { rows } = await query('SELECT user_password_hash FROM users WHERE user_id = $1', [req.user.userId]);
  const valid = await argon2.verify(rows[0].user_password_hash, currentPassword);
  if (!valid) throw new ApiError(401, 'Current password is incorrect');

  const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await query('UPDATE users SET user_password_hash = $1 WHERE user_id = $2', [hash, req.user.userId]);
  return res.status(200).json(new ApiResponse(200, null, 'Password changed'));
});

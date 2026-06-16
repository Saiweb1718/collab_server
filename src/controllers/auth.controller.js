import argon2 from 'argon2';
import { query } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateToken, AUTH_COOKIE } from '../middlewares/auth.middlewares.js';

// In production the frontend and API are on different domains, so the cookie
// fallback must be SameSite=None; Secure (None requires Secure). The primary
// auth path is the bearer token in the Authorization header.
const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  sameSite: isProd ? 'none' : 'lax',
  secure: isProd,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const publicUser = (u) => ({
  user_id: u.user_id,
  user_name: u.user_name,
  user_email: u.user_email,
  user_avatar_url: u.user_avatar_url,
  user_created_at: u.user_created_at,
});

export const signup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password) {
    throw new ApiError(400, 'name, email and password are required');
  }
  if (password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters');
  }

  const existing = await query('SELECT 1 FROM users WHERE user_email = $1', [email.toLowerCase()]);
  if (existing.rowCount > 0) throw new ApiError(409, 'An account with this email already exists');

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const { rows } = await query(
    `INSERT INTO users (user_name, user_email, user_password_hash)
     VALUES ($1, $2, $3)
     RETURNING user_id, user_name, user_email, user_avatar_url, user_created_at`,
    [name.trim(), email.toLowerCase(), hash]
  );

  const user = rows[0];
  const token = generateToken(user);
  res.cookie(AUTH_COOKIE, token, cookieOptions);
  return res
    .status(201)
    .json(new ApiResponse(201, { user: publicUser(user), token }, 'Signup successful'));
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password) throw new ApiError(400, 'email and password are required');

  const { rows } = await query('SELECT * FROM users WHERE user_email = $1', [email.toLowerCase()]);
  if (rows.length === 0) throw new ApiError(401, 'Invalid email or password');

  const user = rows[0];
  const valid = await argon2.verify(user.user_password_hash, password);
  if (!valid) throw new ApiError(401, 'Invalid email or password');

  const token = generateToken(user);
  res.cookie(AUTH_COOKIE, token, cookieOptions);
  return res
    .status(200)
    .json(new ApiResponse(200, { user: publicUser(user), token }, 'Login successful'));
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie(AUTH_COOKIE, cookieOptions);
  return res.status(200).json(new ApiResponse(200, null, 'Logged out'));
});

// Returns the currently-authenticated user (front end uses this to bootstrap).
export const me = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT user_id, user_name, user_email, user_avatar_url, user_created_at FROM users WHERE user_id = $1',
    [req.user.userId]
  );
  if (rows.length === 0) throw new ApiError(404, 'User not found');
  return res.status(200).json(new ApiResponse(200, { user: rows[0] }, 'OK'));
});

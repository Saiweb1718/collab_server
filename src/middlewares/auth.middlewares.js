import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';

export const SECRET = process.env.JWT_SECRET || 'SECr3t';
const TOKEN_EXPIRY = '7d';
export const AUTH_COOKIE = 'authToken';

/**
 * Create a signed JWT for a user. Stores a minimal, stable payload.
 * @param {{ user_id: string, user_email: string, user_name?: string }} user
 */
export const generateToken = (user) =>
  jwt.sign(
    { userId: user.user_id, email: user.user_email, name: user.user_name },
    SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

/** Extract a token from a raw cookie header, an Authorization header, or an explicit token. */
export const extractToken = ({ cookieHeader, authHeader, authToken } = {}) => {
  if (authToken) return authToken;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  if (cookieHeader) {
    const match = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${AUTH_COOKIE}=`));
    if (match) return decodeURIComponent(match.split('=')[1]);
  }
  return null;
};

/** Verify a token string, returning its decoded payload or throwing. */
export const verifyToken = (token) => jwt.verify(token, SECRET);

/** Express middleware: requires a valid token, attaches req.user. */
export const Authorize = (req, res, next) => {
  try {
    const token = extractToken({
      cookieHeader: req.headers.cookie,
      authHeader: req.headers.authorization,
    });
    if (!token) throw new ApiError(401, 'Authentication required');

    const decoded = verifyToken(token);
    req.user = { userId: decoded.userId, email: decoded.email, name: decoded.name };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    return next(new ApiError(401, 'Invalid or expired token'));
  }
};

// Backwards-compatible alias used by older imports.
export const generatetoken = generateToken;

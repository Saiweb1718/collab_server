// Wraps async route handlers so thrown errors reach the central error handler
// instead of crashing the process / hanging the request.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;

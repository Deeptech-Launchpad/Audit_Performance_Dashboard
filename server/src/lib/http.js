export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (m, d) => new HttpError(400, m, d);
/** Wrap async route handlers so rejected promises reach the error middleware */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

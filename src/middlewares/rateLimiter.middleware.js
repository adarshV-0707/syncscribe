import rateLimit from "express-rate-limit";

// Limits repeated invite join attempts because this endpoint writes data.
export const joinRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: "Too many join attempts. Please try again after 15 minutes.",
  },
});

// Limits public invite previews because this endpoint does not require auth.
export const previewRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: "Too many preview attempts. Please try again after 15 minutes.",
  },
});

// Limits invite link creation to reduce abuse from compromised accounts.
export const createInviteLinkRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: "Too many invite links created. Please try again after an hour.",
  },
});

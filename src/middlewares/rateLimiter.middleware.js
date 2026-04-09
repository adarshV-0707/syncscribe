import rateLimit from "express-rate-limit"

// ─────────────────────────────────────────
// POST /join/:token
// Strictest — runs a Mongoose transaction + collaborator create
// 10 attempts per IP per 15 minutes
// ─────────────────────────────────────────
export const joinRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        statusCode: 429,
        message: "Too many join attempts. Please try again after 15 minutes."
    }
})


// ─────────────────────────────────────────
// GET /join/:token
// Public endpoint — no auth, two DB reads per hit
// 30 previews per IP per 15 minutes
// Lighter than join since it's read-only, but still needs protection
// ─────────────────────────────────────────
export const previewRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        statusCode: 429,
        message: "Too many preview attempts. Please try again after 15 minutes."
    }
})


// ─────────────────────────────────────────
// POST /:documentId/invite-links
// JWT required but still a DB write — compromised token abuse
// 20 invite link creations per IP per hour
// ─────────────────────────────────────────
export const createInviteLinkRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        statusCode: 429,
        message: "Too many invite links created. Please try again after an hour."
    }
})
import { Router } from "express"
import { verifyJWT } from "../middlewares/auth.middleware.js"
import {
    joinRateLimiter,
    previewRateLimiter,
    createInviteLinkRateLimiter
} from "../middlewares/rateLimiter.middleware.js"
import {
    createInviteLink,
    getInviteLinks,
    revokeInviteLink,
    previewInviteLink,
    joinViaInviteLink
} from "../controllers/invite_link.controller.js"

const router = Router()

// ── Owner-only routes ──
// createInviteLink: rate limiter before JWT — blocks exhausted IPs before auth layer
router.post("/:documentId/invite-links", createInviteLinkRateLimiter, verifyJWT, createInviteLink)
router.get("/:documentId/invite-links", verifyJWT, getInviteLinks)
router.patch("/:documentId/invite-links/:linkId/revoke", verifyJWT, revokeInviteLink)

// ── Public preview — rate limited, no auth ──
router.get("/join/:token", previewRateLimiter, previewInviteLink)

// ── Join — rate limiter before JWT ──
router.post("/join/:token", joinRateLimiter, verifyJWT, joinViaInviteLink)

export default router
import crypto from "crypto"
import mongoose from "mongoose"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { InviteLink } from "../models/invite_link.model.js"
import { Document } from "../models/document.model.js"
import { Collaborator } from "../models/collaborator.model.js"

const hashToken = (token) =>
    crypto.createHash("sha256").update(token).digest("hex")


// ─────────────────────────────────────────
// POST /:documentId/invite-links
// Owner only — returns raw token ONCE, never again
// ─────────────────────────────────────────
const createInviteLink = asyncHandler(async (req, res) => {
    let { role, maxUses, expiresAt } = req.body
    role = role?.trim()

    const { documentId } = req.params
    const userId = req.user._id

    if (!role || !["editor", "viewer"].includes(role)) {
        throw new ApiError(400, "Role must be 'editor' or 'viewer'")
    }

    let parsedMaxUses = null
    if (maxUses !== undefined && maxUses !== null && maxUses !== "") {
        parsedMaxUses = parseInt(maxUses)
        if (isNaN(parsedMaxUses) || parsedMaxUses < 1) {
            throw new ApiError(400, "maxUses must be a positive integer")
        }
    }

    let parsedExpiresAt = null
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
        parsedExpiresAt = new Date(expiresAt)
        if (isNaN(parsedExpiresAt.getTime())) {
            throw new ApiError(400, "Invalid expiresAt date format")
        }
        if (parsedExpiresAt <= new Date()) {
            throw new ApiError(400, "expiresAt must be a future date")
        }
    }

    const document = await Document.findOne({ _id: documentId, owner: userId, status: "active" })
    if (!document) throw new ApiError(404, "Document not found or you are not the owner")

    const rawToken = crypto.randomBytes(32).toString("hex")
    const tokenHash = hashToken(rawToken)

    const inviteLink = await InviteLink.create({
        document: documentId,
        tokenHash,
        role,
        maxUses: parsedMaxUses,
        expiresAt: parsedExpiresAt,
        createdBy: userId
    })

    // Explicit allowlist — schema additions never leak to client automatically
    const responseData = {
        _id: inviteLink._id,
        document: inviteLink.document,
        token: rawToken,            // raw token — only exposure ever
        role: inviteLink.role,
        maxUses: inviteLink.maxUses,
        usedCount: inviteLink.usedCount,
        expiresAt: inviteLink.expiresAt,
        isActive: inviteLink.isActive,
        createdBy: inviteLink.createdBy,
        createdAt: inviteLink.createdAt,
        updatedAt: inviteLink.updatedAt
    }

    return res.status(201).json(
        new ApiResponse(201, responseData, "Invite link created successfully")
    )
})


// ─────────────────────────────────────────
// GET /:documentId/invite-links
// Owner only — tokenHash never returned (useless to client)
// ─────────────────────────────────────────
const getInviteLinks = asyncHandler(async (req, res) => {
    const { documentId } = req.params
    const userId = req.user._id

    const document = await Document.findOne({ _id: documentId, owner: userId, status: "active" })
    if (!document) throw new ApiError(404, "Document not found or you are not the owner")

    const inviteLinks = await InviteLink.find({ document: documentId, isActive: true })
        .select("-tokenHash")
        .sort({ createdAt: -1 })
        .lean()

    return res.status(200).json(
        new ApiResponse(200, inviteLinks, "Invite links fetched successfully")
    )
})


// ─────────────────────────────────────────
// PATCH /:documentId/invite-links/:linkId/revoke
// Owner only — soft delete, preserves usedCount history
// ─────────────────────────────────────────
const revokeInviteLink = asyncHandler(async (req, res) => {
    const { documentId, linkId } = req.params
    const userId = req.user._id

    const document = await Document.findOne({ _id: documentId, owner: userId, status: "active" })
    if (!document) throw new ApiError(404, "Document not found or you are not the owner")

    const inviteLink = await InviteLink.findOneAndUpdate(
        { _id: linkId, document: documentId, isActive: true },
        { isActive: false },
        { new: true }
    )

    if (!inviteLink) throw new ApiError(404, "Active invite link not found")

    return res.status(200).json(
        new ApiResponse(200, null , "Invite link revoked successfully")
    )
})


// ─────────────────────────────────────────
// GET /join/:token
// Preview before joining — pure read, no state mutation
// Two-query pattern: optimistic first, diagnostic on miss
// ─────────────────────────────────────────
const previewInviteLink = asyncHandler(async (req, res) => {
    const { token } = req.params
    const tokenHash = hashToken(token)

    const inviteLink = await InviteLink.findOne({
        tokenHash,
        isActive: true,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        $expr: {
            $or: [
                { $eq: ["$maxUses", null] },
                { $lt: ["$usedCount", "$maxUses"] }
            ]
        }
    })
        .populate("document", "title description")
        .populate("createdBy", "name username")
        .lean()

    if (!inviteLink) {
        const existing = await InviteLink.findOne({ tokenHash }).lean()
        if (!existing) throw new ApiError(404, "Invite link is invalid")
        if (!existing.isActive) throw new ApiError(410, "Invite link has been revoked")
        if (existing.expiresAt && existing.expiresAt < new Date()) {
            throw new ApiError(410, "Invite link has expired")
        }
        throw new ApiError(410, "Invite link has reached its maximum number of uses")
    }

    const data = {
        document: inviteLink.document,
        role: inviteLink.role,
        expiresAt: inviteLink.expiresAt,
        createdBy: inviteLink.createdBy
    }

    return res.status(200).json(
        new ApiResponse(200, data, "Invite link preview fetched successfully")
    )
})


// ─────────────────────────────────────────
// POST /join/:token
// Race condition architecture:
//   Phase 1 — Lightweight: existence + isActive only
//             Expiry/maxUses intentionally excluded — they're stale on read
//   Phase 2 — Atomic findOneAndUpdate: real validation gate + slot claim
//             Diagnostic query after atomic miss gives specific error messages
//             TransientTransactionError retry (up to 3 attempts)
//   Post-tx  — isActive deactivation: not correctness-critical, lives outside tx
// ─────────────────────────────────────────
const joinViaInviteLink = asyncHandler(async (req, res) => {
    const { token } = req.params
    const userId = req.user._id
    const tokenHash = hashToken(token)

    // ── Phase 1: Lightweight — existence + active only ──
    const inviteLink = await InviteLink.findOne({ tokenHash })
    if (!inviteLink) throw new ApiError(404, "Invite link is invalid")
    if (!inviteLink.isActive) throw new ApiError(410, "Invite link has been revoked")

    const documentId = inviteLink.document

    const [document, existingCollaborator] = await Promise.all([
        Document.findOne({ _id: documentId, status: "active" }),
        Collaborator.findOne({ document: documentId, user: userId })
    ])

    if (!document) throw new ApiError(404, "Document is no longer available")
    if (document.owner.equals(userId)) {
        throw new ApiError(400, "You are already the owner of this document")
    }
    if (existingCollaborator) {
        throw new ApiError(409, "You are already a collaborator on this document")
    }

    // ── Phase 2: Transaction with TransientTransactionError retry ──
    const session = await mongoose.startSession()
    let claimed = null

    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            session.startTransaction()
            try {
                // Atomic gate — this is the real validation, not Phase 1
                // Flat query: easier to reason about, no nested $and[$or, $or]
                claimed = await InviteLink.findOneAndUpdate(
                    {
                        _id: inviteLink._id,
                        isActive: true,
                        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
                        $expr: {
                            $or: [
                                { $eq: ["$maxUses", null] },
                                { $lt: ["$usedCount", "$maxUses"] }
                            ]
                        }
                    },
                    { $inc: { usedCount: 1 } },
                    { new: true, session }
                )

                if (!claimed) {
                    // Atomic gate rejected — diagnose exact reason for specific error
                    const failed = await InviteLink.findById(inviteLink._id).lean()
                    if (failed.expiresAt && failed.expiresAt < new Date()) {
                        throw new ApiError(410, "Invite link has expired")
                    }
                    if (failed.maxUses !== null && failed.usedCount >= failed.maxUses) {
                        throw new ApiError(410, "Invite link has reached its maximum number of uses")
                    }
                    throw new ApiError(409, "Invite link was just exhausted, please try again")
                }

                await Collaborator.create(
                    [{ document: documentId, user: userId, role: claimed.role, invitedBy: inviteLink.createdBy }],
                    { session }
                )

                await session.commitTransaction()
                break

            } catch (err) {
                await session.abortTransaction()

                if (err.hasErrorLabel?.("TransientTransactionError") && attempt < 2) continue

                if (err.code === 11000) {
                    throw new ApiError(409, "You are already a collaborator on this document")
                }

                throw err
            }
        }
    } finally {
        session.endSession()
    }

    // ── Post-transaction: deactivate if maxUses hit ──
    // Not correctness-critical — collaborator is already created above
    // updateOne with isActive: true guard prevents double-write on concurrent hits
    if (claimed.maxUses !== null && claimed.usedCount >= claimed.maxUses) {
        await InviteLink.updateOne(
            { _id: claimed._id, isActive: true },
            { isActive: false }
        )
    }

    return res.status(200).json(
        new ApiResponse(200, { documentId, role: claimed.role }, "Successfully joined the document")
    )
})


export {
    createInviteLink,
    getInviteLinks,
    revokeInviteLink,
    previewInviteLink,
    joinViaInviteLink
}
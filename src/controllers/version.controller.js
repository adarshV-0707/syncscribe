import mongoose from "mongoose"
import { createPatch, applyPatch } from "diff"
import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { Version } from "../models/version.model.js"
import { Document } from "../models/document.model.js"
import { Collaborator } from "../models/collaborator.model.js"

const SNAPSHOT_INTERVAL = 10

// ── Diff helpers — swap implementation here without touching controllers ──
const computeDelta = (base, head) =>
    createPatch("document", base, head)

const applyDelta = (base, delta) => {
    const result = applyPatch(base, delta)
    if (result === false)
        throw new ApiError(500, "Version reconstruction failed — delta is corrupt")
    return result
}

// ── Permission helper ──────────────────────────────────────────────────────
// Owner path skips the Collaborator query entirely — avoids the extra DB hit
// for the common case. requireEditor blocks viewer collaborators on write paths.
const assertDocumentAccess = async (
    documentId,
    userId,
    { requireEditor = false, selectFields = "owner" } = {}
) => {
    const document = await Document.findOne({ _id: documentId, status: "active" })
        .select(selectFields)
        .lean()
    if (!document) throw new ApiError(404, "Document not found")

    if (document.owner.equals(userId)) return document

    const query = { document: documentId, user: userId }
    if (requireEditor) query.role = "editor"

    const collaborator = await Collaborator.findOne(query).select("_id").lean()
    if (!collaborator)
        throw new ApiError(403, requireEditor ? "Editor access required" : "Access denied")

    return document
}


// ─────────────────────────────────────────
// POST /:documentId/versions
// Owner or editor — snapshot or diff, decided by SNAPSHOT_INTERVAL
// Transaction scope: nextVersionNumber → Version.create → Document lastEditedBy
// ─────────────────────────────────────────
const createVersion = asyncHandler(async (req, res) => {
    const { documentId } = req.params
    const userId = req.user._id
    const { label } = req.body

    // Fetches owner + content in one query — content needed for delta computation
    // outside the transaction so it doesn't extend the tx window unnecessarily
    const document = await assertDocumentAccess(documentId, userId, {
        requireEditor: true,
        selectFields: "owner content"
    })

    const session = await mongoose.startSession()
    let savedVersion

    try {
        session.startTransaction()

        const versionNumber = await Version.nextVersionNumber(documentId, session)

        // Versions 1, 11, 21 ... are full snapshots; everything between is a diff
        const isSnapshot = (versionNumber - 1) % SNAPSHOT_INTERVAL === 0

        const payload = {
            documentId,
            versionNumber,
            type: isSnapshot ? "snapshot" : "diff",
            label: label?.trim() || null,
            createdBy: userId
        }

        if (isSnapshot) {
            payload.content = document.content
        } else {
            // Read inside session — ensures we diff against committed snapshot state
            const nearestSnapshot = await Version.findOne({
                documentId,
                type: "snapshot",
                versionNumber: { $lt: versionNumber }
            })
                .sort({ versionNumber: -1 })
                .select("_id content")
                .session(session)
                .lean()

            if (!nearestSnapshot) {
                // No committed snapshot exists yet — degrade gracefully
                payload.type = "snapshot"
                payload.content = document.content
            } else {
                payload.delta = computeDelta(nearestSnapshot.content, document.content)
                payload.snapshotRef = nearestSnapshot._id
            }
        }

        ;[savedVersion] = await Version.create([payload], { session })

        await Document.findByIdAndUpdate(
            documentId,
            { lastEditedBy: userId },
            { session }
        )

        await session.commitTransaction()

    } catch (err) {
        await session.abortTransaction()
        if (err.code === 11000) throw new ApiError(409, "Version conflict — please retry")
        throw err
    } finally {
        session.endSession()
    }

    // Strip storage fields — client receives metadata only on create
    const { content: _c, delta: _d, snapshotRef: _s, ...responseData } = savedVersion.toObject()

    return res.status(201).json(
        new ApiResponse(201, responseData, "Version saved successfully")
    )
})

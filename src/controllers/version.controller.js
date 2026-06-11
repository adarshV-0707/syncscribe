// src/controllers/versionController.js
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Version } from "../models/version.model.js";
import { applyDelta } from "../utils/deltaHelpers.js";
import { assertDocumentAccess } from "../utils/assertDocumentAccess.js";
import { createVersionCore } from "../services/versionService.js";

// mongoose import removed — controller no longer opens sessions directly
// computeDelta import removed — only needed inside versionService now

// ─────────────────────────────────────────────────────────────────
// POST /:documentId/versions
// Thin HTTP wrapper around createVersionCore
// Permission check here — content fetch happens inside the service
// ─────────────────────────────────────────────────────────────────
const createVersion = asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const { label } = req.body;

    // Only permission check — no selectFields needed, no content fetched here
    const document = await assertDocumentAccess(documentId, req.user._id, {
        requireEditor: true,
        selectFields: "content",
    });

    // All core logic delegated to service
    const savedVersion = await createVersionCore({
        documentId,
        documentContent: document.content,
        userId: req.user._id,
        label,
    });

    const responseData = {
        _id: savedVersion._id,
        documentId: savedVersion.documentId,
        versionNumber: savedVersion.versionNumber,
        type: savedVersion.type,
        label: savedVersion.label,
        createdBy: {
            _id: req.user._id,
            name: req.user.name,
            username: req.user.username,
        },
        createdAt: savedVersion.createdAt,
    };

    return res
        .status(201)
        .json(new ApiResponse(201, responseData, "Version saved successfully"));
});

// ─────────────────────────────────────────────────────────────────
// GET /:documentId/versions
// Owner or any collaborator — paginated version history
// ─────────────────────────────────────────────────────────────────
const listVersions = asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const userId = req.user._id;

    await assertDocumentAccess(documentId, userId);

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    const [versions, total] = await Promise.all([
        Version.find({ documentId })
            .select("-content -delta -snapshotRef")
            .sort({ versionNumber: -1 })
            .skip(skip)
            .limit(limit)
            .populate("createdBy", "name username")
            .lean(),
        Version.countDocuments({ documentId }),
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                versions,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                    hasNext: page * limit < total,
                },
            },
            "Version history fetched successfully",
        ),
    );
});

// ─────────────────────────────────────────────────────────────────
// GET /:documentId/versions/:versionId
// Owner or any collaborator — reconstructs content from snapshot or diff
// ─────────────────────────────────────────────────────────────────
const getVersion = asyncHandler(async (req, res) => {
    const { documentId, versionId } = req.params;
    const userId = req.user._id;

    await assertDocumentAccess(documentId, userId);

    const version = await Version.findOne({ _id: versionId, documentId })
        .populate("createdBy", "name username")
        .lean();

    if (!version) throw new ApiError(404, "Version not found");

    let content;

    if (version.type === "snapshot") {
        content = version.content;
    } else {
        if (!version.snapshotRef)
            throw new ApiError(
                500,
                "Diff version is missing snapshot reference",
            );

        const snapshot = await Version.findOne({
            _id: version.snapshotRef,
            documentId,
            type: "snapshot",
        })
            .select("content")
            .lean();

        if (!snapshot)
            throw new ApiError(
                500,
                "Referenced snapshot not found — version chain is broken",
            );

        content = applyDelta(snapshot.content, version.delta);
    }

    const responseData = {
        _id: version._id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        type: version.type,
        label: version.label ?? null,
        createdBy: version.createdBy ?? {
            _id: null,
            name: "Deleted User",
            username: null,
        },
        createdAt: version.createdAt,
        content,
    };

    return res
        .status(200)
        .json(new ApiResponse(200, responseData, "Version fetched successfully"));
});

export { createVersion, listVersions, getVersion };
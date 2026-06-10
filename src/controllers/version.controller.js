import mongoose from "mongoose";
import { createPatch, applyPatch } from "diff";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Version } from "../models/version.model.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js";

const SNAPSHOT_INTERVAL = 10;

// ── Diff helpers — swap implementation here without touching controllers ──
const computeDelta = (base, head) => createPatch("document", base, head);

const applyDelta = (base, delta) => {
  const result = applyPatch(base, delta);
  if (result === false)
    throw new ApiError(500, "Version reconstruction failed — delta is corrupt");
  return result;
};

// ── Permission helper ──────────────────────────────────────────────────────
// Owner path skips the Collaborator query entirely — avoids the extra DB hit
// for the common case. requireEditor blocks viewer collaborators on write paths.
const assertDocumentAccess = async (
  documentId,
  userId,
  { requireEditor = false, selectFields = "owner" } = {},
) => {
  const document = await Document.findOne({ _id: documentId, status: "active" })
    .select(selectFields)
    .lean();
  if (!document) throw new ApiError(404, "Document not found");

  if (document.owner.equals(userId)) return document;

  const query = { document: documentId, user: userId };
  if (requireEditor) query.role = "editor";

  const collaborator = await Collaborator.findOne(query).select("_id").lean();
  if (!collaborator)
    throw new ApiError(
      403,
      requireEditor ? "Editor access required" : "Access denied",
    );

  return document;
};

// ─────────────────────────────────────────
// POST /:documentId/versions
// Owner or editor — snapshot or diff, decided by SNAPSHOT_INTERVAL
// Transaction scope: nextVersionNumber → Version.create → Document lastEditedBy
// ─────────────────────────────────────────
const createVersion = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const userId = req.user._id;
  const { label } = req.body;

  const document = await assertDocumentAccess(documentId, userId, {
    requireEditor: true,
    selectFields: "owner content",
  });

  const session = await mongoose.startSession();
  let savedVersion;
  session.startTransaction();

  try {
    const versionNumber = await Version.nextVersionNumber(documentId, session);

    const isSnapshot = (versionNumber - 1) % SNAPSHOT_INTERVAL === 0;

    const payload = {
      documentId,
      versionNumber,
      type: isSnapshot ? "snapshot" : "diff",
      label: label?.trim() || null,
      createdBy: userId,
    };

    if (isSnapshot) {
      payload.content = document.content;
    } else {
      const nearestSnapshot = await Version.findOne({
        documentId,
        type: "snapshot",
        versionNumber: { $lt: versionNumber },
      })
        .sort({ versionNumber: -1 })
        .select("_id content")
        .session(session)
        .lean();

      if (!nearestSnapshot) {
        payload.type = "snapshot";
        payload.content = document.content;
      } else {
        payload.delta = computeDelta(nearestSnapshot.content, document.content);
        payload.snapshotRef = nearestSnapshot._id;
      }
    }

    [savedVersion] = await Version.create([payload], { session });

    await Document.findByIdAndUpdate(
      documentId,
      { lastEditedBy: userId },
      { session },
    );

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    if (err.code === 11000)
      throw new ApiError(409, "Version conflict — please retry");
    throw err;
  } finally {
    session.endSession();
  }

  // Explicit shape — no DB call, no field stripping, no accidental leaks
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

// ─────────────────────────────────────────
// GET /:documentId/versions/:versionId
// Owner or any collaborator — reconstructs content from snapshot or diff
// ─────────────────────────────────────────
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
    // diff — need the snapshot it was diffed against
    if (!version.snapshotRef) {
      throw new ApiError(500, "Diff version is missing snapshot reference");
    }

    const snapshot = await Version.findOne({
      _id: version.snapshotRef,
      documentId,        // ensures the snapshot belongs to same document
      type: "snapshot",
    })
      .select("content")
      .lean();

    if (!snapshot) {
      throw new ApiError(500, "Referenced snapshot not found — version chain is broken");
    }

    content = applyDelta(snapshot.content, version.delta);
  }

  const responseData = {
    _id: version._id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    type: version.type,
    label: version.label ?? null,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    content,
  };

  return res
    .status(200)
    .json(new ApiResponse(200, responseData, "Version fetched successfully"));
});

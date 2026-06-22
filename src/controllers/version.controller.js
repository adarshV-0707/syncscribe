import mongoose from "mongoose";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Version } from "../models/version.model.js";
import { applyDelta } from "../utils/deltaHelpers.js";
import { assertDocumentAccess } from "../utils/assertDocumentAccess.js";

// Fetches paginated version history metadata for users who can access the document.
const listVersions = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const userId = req.user._id;

  await assertDocumentAccess(documentId, userId);

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 50);
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

// Fetches a specific version and reconstructs its content when it is stored as a diff.
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
      throw new ApiError(500, "Diff version is missing snapshot reference");

    const snapshot = await Version.findOne({
      _id: version.snapshotRef,
      documentId,
      type: "snapshot",
    })
      .select("content")
      .lean();

    if (!snapshot){
      throw new ApiError(
        500,
        "Referenced snapshot not found — version chain is broken",
      );
    }

    // Diff versions are reconstructed by applying their patch to the referenced snapshot.
    content = applyDelta(snapshot.content, version.delta);
    if (content === false || typeof content !== "string") {
      throw new ApiError(500, "Failed to reconstruct version content");
     }
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        _id: version._id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        type: version.type,
        label: version.label ?? null,
        basedOnVersion: version.basedOnVersion,
        wasConflicted: version.wasConflicted,
        saveType: version.saveType,
        createdBy: version.createdBy ?? {
          _id: null,
          name: "Deleted User",
          username: null,
        },
        createdAt: version.createdAt,
        content,
      },
      "Version fetched successfully",
    ),
  );
});

// Returns contribution stats grouped by the users who created versions.
const getContributions = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const userId = req.user._id;
  
  // Owner access required as only owner can see stats
  await assertDocumentAccess(documentId, userId, {requireOwner:true});

  const contributions = await Version.aggregate([
  {
    $match: {
      documentId: new mongoose.Types.ObjectId(documentId),
    },
  },
  {
    $group: {
      _id: "$createdBy",
      versionCount: { $sum: 1 },
      firstEdit: { $min: "$createdAt" },
      lastEdit: { $max: "$createdAt" },
    },
  },
  {
    $lookup: {
      from: "users",
      localField: "_id",
      foreignField: "_id",
      as: "user",
    },
  },
  { $unwind: "$user" },
  {
    $project: {
      _id: 0,
      userId: "$_id",
      name: "$user.name",
      username: "$user.username",
      versionCount: 1,
      firstEdit: 1,
      lastEdit: 1,
    },
  },
  { $sort: { versionCount: -1 } },
]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        contributions,
        "Contributions fetched successfully",
      ),
    );
});

export {
  listVersions,
  getVersion,
  getContributions,
};
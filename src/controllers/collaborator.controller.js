import mongoose from "mongoose";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js";
import { User } from "../models/user.model.js";
import { assertDocumentAccess } from "../utils/assertDocumentAccess.js";



const removeCollaborator = asyncHandler(async (req, res) => {
  const { documentId, collaboratorId } = req.params;

  await assertDocumentAccess(documentId, req.user._id, {
    requireOwner: true,
  });

  const collaborator = await Collaborator.findOneAndDelete({
    _id: collaboratorId,
    document: documentId,
  });

  if (!collaborator) {
    throw new ApiError(404, "Collaborator not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Collaborator removed successfully"));
});

const getCollaborators = asyncHandler(async (req, res) => {
  const { documentId } = req.params;

  await assertDocumentAccess(documentId, req.user._id, {
    requireOwner: true,
  });

  const collaborators = await Collaborator.find({
    document: documentId,
  })
    .populate("user", "name username avatar")
    .populate("invitedBy", "name username avatar")
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      collaborators,
      collaborators.length === 0
        ? "No collaborators found"
        : "Collaborators fetched successfully",
    ),
  );
});

const leaveDocument = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const userId = req.user._id;

  const document = await Document.findOne({
    _id: documentId,
    status: "active",
  }).select("_id owner");

  if (!document) {
    throw new ApiError(404, "Document not found");
  }

  if (document.owner.equals(userId)) {
    throw new ApiError(400, "Owner cannot leave their own document");
  }

  const collaborator = await Collaborator.findOneAndDelete({
    document: documentId,
    user: userId,
  });

  if (!collaborator) {
    throw new ApiError(404, "You are not a collaborator of this document");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "You have left the document successfully"));
});

const updateCollaboratorRole = asyncHandler(async (req, res) => {
  const { documentId, userId } = req.params;
  const { newRole } = req.body;

  if (!["editor", "viewer"].includes(newRole)) {
    throw new ApiError(400, "Invalid role. Must be editor or viewer");
  }

  await assertDocumentAccess(documentId, req.user._id, {
    requireOwner: true,
  });

  const collaborator = await Collaborator.findOneAndUpdate(
    {
      document: documentId,
      user: userId,
    },
    {
      $set: { role: newRole },
    },
    {
      new: true,
      runValidators: true,
    },
  )
    .populate("user", "name username avatar")
    .populate("invitedBy", "name username avatar");

  if (!collaborator) {
    throw new ApiError(404, "Collaborator not found");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        collaborator,
        "Collaborator role updated successfully",
      ),
    );
});



export {
  removeCollaborator,
  getCollaborators,
  leaveDocument,
  updateCollaboratorRole,
};

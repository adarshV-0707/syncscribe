import mongoose from "mongoose";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js";
import { User } from "../models/user.model.js";
import { getIO } from "../utils/socket/socketInstance.js";

const addCollaborator = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  let { email, username, role } = req.body;
  email = email?.trim().toLowerCase();
  username = username?.trim().toLowerCase();

  if (!email && !username) {
    throw new ApiError(400, "Email or username is required");
  }

  if (!["editor", "viewer"].includes(role)) {
    throw new ApiError(400, "Invalid role. Must be editor or viewer");
  }

  const searchQuery = [];
  if (username) searchQuery.push({ username });
  if (email) searchQuery.push({ email });

  const [document, user] = await Promise.all([
    Document.findOne({
      _id: documentId,
      status: "active",
      owner: req.user._id,
    }),
    User.findOne({ $or: searchQuery }),
  ]);

  if (!document) {
    throw new ApiError(404, "Document not found or not authorized");
  }

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (user._id.equals(document.owner)) {
    throw new ApiError(400, "Owner cannot be added as collaborator");
  }

  try {
    const collaborator = await Collaborator.create({
      document: documentId,
      user: user._id,
      role,
      invitedBy: req.user._id,
    });

    await collaborator.populate([
      { path: "user", select: "name username avatar" },
      { path: "invitedBy", select: "name username avatar" },
    ]);
    
    const io = getIO();
    io.to(documentId.toString()).emit("collaborator_added", {
      docId: documentId,
      collaborator: {
        _id: collaborator._id,
        user: collaborator.user,
        role: collaborator.role,
        invitedBy: collaborator.invitedBy,
      },
    });

    return res
      .status(201)
      .json(
        new ApiResponse(201, collaborator, "Collaborator added successfully"),
      );
  } catch (error) {
    if (error.code === 11000) {
      throw new ApiError(409, "User is already a collaborator");
    }
    throw error;
  }
});

const removeCollaborator = asyncHandler(async (req, res) => {
  const { documentId, collaboratorId } = req.params;

  const document = await Document.findOne({
    _id: documentId,
    status: "active",
    owner: req.user._id,
  });

  if (!document) {
    throw new ApiError(404, "Document not found or not authorized");
  }

  const collaborator = await Collaborator.findOneAndDelete({
    _id: collaboratorId,
    document: documentId,
  });

  if (!collaborator) {
    throw new ApiError(404, "Collaborator not found");
  }

  const io = getIO();
  io.to(documentId.toString()).emit("collaborator_removed", {
      docId: documentId,
      collaboratorId,
      userId: collaborator.user,
      message: "You have been removed from this document.",
    });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Collaborator removed successfully"));
});

const getCollaborators = asyncHandler(async (req, res) => {
  const { documentId } = req.params;

  const document = await Document.findOne({
    _id: documentId,
    status: "active",
  });

  if (!document) {
    throw new ApiError(404, "Document not found");
  }

  const isOwner = document.owner.equals(req.user._id);

  if (!isOwner) {
    const isCollaborator = await Collaborator.exists({
      document: documentId,
      user: req.user._id,
    });

    if (!isCollaborator) {
      throw new ApiError(403, "You do not have access to this document");
    }
  }

  const collaborators = await Collaborator.find({
    document: documentId,
  })
    .populate("user", "name username avatar")
    .populate("invitedBy", "name username avatar");

  return res
    .status(200)
    .json(
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

  const collaborator = await Collaborator.findOneAndDelete({
    document: documentId,
    user: req.user._id,
  });

  if (!collaborator) {
    throw new ApiError(404, "You are not a collaborator of this document");
  }
    
  const io = getIO();
  io.to(documentId.toString()).emit("collaborator_left", {
    docId: documentId,
    userId: req.user._id,
  });

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

  const document = await Document.findOne({
    _id: documentId,
    status: "active",
    owner: req.user._id,
  });

  if (!document) {
    throw new ApiError(404, "Document not found or not authorized");
  }

  const collaborator = await Collaborator.findOneAndUpdate(
    {
      document: documentId,
      user: userId,
    },
    {
      $set: { role: newRole },
    },
    { new: true },
  )
    .populate("user", "name username avatar")
    .populate("invitedBy", "name username avatar");

  if (!collaborator) {
    throw new ApiError(404, "Collaborator not found");
  }

  const io = getIO();
  io.to(documentId.toString()).emit("collaborator_role_updated", {
    docId: documentId,
    userId,
    newRole,
    updatedBy: req.user._id,
    });

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
  addCollaborator,
  removeCollaborator,
  getCollaborators,
  leaveDocument,
  updateCollaboratorRole,
};

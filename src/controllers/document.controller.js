import mongoose from "mongoose";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js";
import { InviteLink } from "../models/inviteLink.model.js";
import { Version } from "../models/version.model.js";
import { getIO } from "../utils/socket/socketInstance.js";
import { clearActiveDocumentUsers } from "../utils/socket/activeUsersStore.js";

// Creates a document with its initial snapshot version in one transaction.
const createDocument = asyncHandler(async (req, res) => {
  const { title, description } = req.body;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [document] = await Document.create(
      [
        {
          title: title?.trim() || "Untitled Document",
          description: description?.trim() || "",
          content: "",
          owner: req.user._id,
          lastEditedBy: req.user._id,
          lastEditedAt: new Date(),
          latestVersion: 1,
          status: "active",
        },
      ],
      { session },
    );

    await Version.create(
      [
        {
          documentId: document._id,
          versionNumber: 1,
          type: "snapshot",
          content: "",
          label: "Initial Draft",
          createdBy: req.user._id,
          basedOnVersion: 0,
          wasConflicted: false,
          saveType: "manual",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    const createdDocument = await Document.findById(document._id)
      .populate("owner", "name username avatar")
      .populate("lastEditedBy", "name username avatar");

    return res
      .status(201)
      .json(
        new ApiResponse(201, createdDocument, "Document created successfully"),
      );
  } catch (error) {
    await session.abortTransaction();

    if (error.code === 11000) {
      throw new ApiError(409, "Document version conflict, please retry");
    }

    throw error;
  } finally {
    session.endSession();
  }
});

// Fetches an active document and returns the current user's role.
const getDocument = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const userId = req.user._id;

  const document = await Document.findOne({
    _id: documentId,
    status: "active",
  })
    .populate("owner", "name username avatar")
    .populate("lastEditedBy", "name username avatar");

  if (!document) {
    throw new ApiError(404, "Document not found");
  }

  const isOwner = document.owner._id.toString() === userId.toString();

  let role = "owner";

  if (!isOwner) {
    const collaborator = await Collaborator.findOne({
      document: documentId,
      user: userId,
    })
      .select("role")
      .lean();

    if (!collaborator) {
      throw new ApiError(403, "User does not have access to this document");
    }

    role = collaborator.role;
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        document,
        role,
        latestVersion: document.latestVersion,
      },
      "Document fetched successfully",
    ),
  );
});

// Updates owner-only document metadata without changing document content.
const updateDocumentInfo = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const { newTitle, newDescription } = req.body;

  // 1. Ensure at least one field was actually sent in the request
  if (newTitle === undefined && newDescription === undefined) {
    throw new ApiError(400, "At least one field is required to update");
  }

  const updateFields = {};

  if (newTitle !== undefined) {
    const title = newTitle.trim();
    if (!title) {
      throw new ApiError(400, "Document title cannot be empty");
    }
    updateFields.title = title;
  }

  if (newDescription !== undefined) {
    updateFields.description = newDescription.trim();
  }

  // 4. Update the tracking field
  updateFields.lastEditedBy = req.user._id;
  updateFields.lastEditedAt = new Date();

  const updatedDocument = await Document.findOneAndUpdate(
    { 
      _id: documentId, 
      status: "active", 
      owner: req.user._id 
    },
    { $set: updateFields },
    { new: true, runValidators: true }
  )
    .populate("owner", "name username avatar")
    .populate("lastEditedBy", "name username avatar");

  if (!updatedDocument) {
    throw new ApiError(404, "Document not found or you do not have permission to edit it");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, updatedDocument, "Document info updated successfully")
    );
});

// Lists the current user's active owned documents with optional title search.
const getOwnedActiveDocuments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search } = req.query;
  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 10, 1), 20);

  const query = {
    owner: req.user._id,
    status: "active",
  };

  const searchTerm = search?.trim();
  if (searchTerm) {
    query.title = { $regex: searchTerm, $options: "i" };
  }
  const [documents, total] = await Promise.all([
    Document.find(query)
      .sort({ updatedAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .populate("owner", "name username avatar")
      .lean(),

    Document.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        documents,
        pagination: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.ceil(total / limitNumber),
        },
      },
      "Documents fetched successfully",
    ),
  );
});

// Lists active documents shared with the current user.
const getSharedDocuments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 10, 1), 20);


  const documentIds = await Collaborator.distinct("document", {
    user: req.user._id,
  });

  let documents = [];
  let total = 0;

  if (documentIds.length > 0) {
    const documentQuery = {
      _id: { $in: documentIds },
      status: "active",
      owner: { $ne: req.user._id },
    };

    [documents, total] = await Promise.all([
      Document.find(documentQuery)
        .populate("owner", "name username avatar")
        .sort({ updatedAt: -1 })
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)
        .lean(),

      Document.countDocuments(documentQuery),
    ]);
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        documents,
        pagination: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.ceil(total / limitNumber),
        },
      },
      documents.length === 0
        ? "No shared documents found"
        : "Shared documents fetched successfully",
    ),
  );
});

// Soft deletes an owner document and removes all active sockets from its room.
const deleteDocument = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const deletedDocument = await Document.findOneAndUpdate(
    {
      _id: documentId,
      status: "active",
      owner: req.user._id,
    },
    {
      $set: { status: "deleted" },
    },
    { new: true },
  );

  if (!deletedDocument) {
    throw new ApiError(404, "Document not found or not authorized");
  }

  // ── Socket: kick all active users ──
  try {
    const io = getIO();
    const roomId = documentId.toString();
    const userId = req.user._id.toString();
    io.to(roomId).emit("document_deleted", {
      docId: roomId,
      deletedBy: userId,
      message: "This document has been deleted by the owner.",
    });
  
    io.in(roomId).socketsLeave(roomId);
    clearActiveDocumentUsers(roomId);
  }
  
  catch (error) {
  console.error("Failed to emit document_deleted event:", error);
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Document deleted successfully"));
});

// Restores a soft-deleted owner document.
const restoreDocument = asyncHandler(async (req, res) => {
  const { documentId } = req.params;

  const restoredDocument = await Document.findOneAndUpdate(
    {
      _id: documentId,
      status: "deleted",
      owner: req.user._id,
    },
    {
      $set: { status: "active" },
    },
    { new: true },
  );

  if (!restoredDocument) {
    throw new ApiError(404, "Document not found or not authorized");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, restoredDocument, "Document restored successfully"),
    );
});

// Lists the current user's soft-deleted documents.
const getDeletedDocuments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 10, 1), 10);

  const query = {
    owner: req.user._id,
    status: "deleted",
  };

  const [documents, total] = await Promise.all([
    Document.find(query)
      .sort({ updatedAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .lean(),
    Document.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        documents,
        pagination: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.ceil(total / limitNumber),
        },
      },
      total === 0
        ? "No deleted documents found"
        : "Deleted documents fetched successfully",
    ),
  );
});

// Searches active document titles across owned and shared documents.
const searchDocument = asyncHandler(async (req, res) => {
  const { query, page = 1, limit = 10 } = req.query;

  if (!query?.trim()) {
    throw new ApiError(400, "Search query is required");
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 10, 1), 20);

  const sharedDocIds = await Collaborator.distinct("document", {
    user: req.user._id,
  });

  const searchQuery = {
    status: "active",
    $or: [{ owner: req.user._id }, { _id: { $in: sharedDocIds } }],
    title: { $regex: query.trim(), $options: "i" },
  };

  const [documents, total] = await Promise.all([
    Document.find(searchQuery)
      .sort({ updatedAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .lean(),
    Document.countDocuments(searchQuery),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        documents,
        pagination: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.ceil(total / limitNumber),
        },
      },
      total === 0 ? "No documents found" : "Documents fetched successfully",
    ),
  );
});

// Permanently deletes a soft-deleted document and its dependent records.
const permanentDeleteDocument = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const userId = req.user._id;

  // Must exist, must be owner, must already be soft-deleted
  const document = await Document.findOne({
    _id: documentId,
    owner: userId,
    status: "deleted",
  })
    .select("_id")
    .lean();

  if (!document)
    throw new ApiError(
      404,
      "Document not found or not eligible for permanent deletion",
    );

  const session = await mongoose.startSession();
  session.startTransaction(); // outside try — synchronous, never throws

  try {
    // Dependents first — all in parallel, same session
    await Promise.all([
      Version.deleteMany({ documentId }, { session }),
      Collaborator.deleteMany({ document: documentId }, { session }),
      InviteLink.deleteMany({ document: documentId }, { session }),
    ]);

    // Parent last — only after dependents are gone
    const deletedDocument = await Document.findOneAndDelete(
      { _id: documentId, owner: userId, status: "deleted"},
      { session },
    );

    if (!deletedDocument) {
      throw new ApiError(409, "Document is no longer eligible for permanent deletion");
   }

    await session.commitTransaction();

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Document permanently deleted"));
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});

export {
  createDocument,
  getDocument,
  getOwnedActiveDocuments,
  getSharedDocuments,
  updateDocumentInfo,
  deleteDocument,
  restoreDocument,
  getDeletedDocuments,
  searchDocument,
  permanentDeleteDocument,
};

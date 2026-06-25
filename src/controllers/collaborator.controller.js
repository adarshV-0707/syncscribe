import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js";
import { assertDocumentAccess } from "../utils/assertDocumentAccess.js";
import { getIO } from "../utils/socket/socketInstance.js";
import { activeUsers } from "../utils/socket/activeUsersStore.js";

// Removes a user's active sockets from a document room.
const removeUserSocketsFromDocumentRoom = (
  io,
  documentId,
  userId,
  {
    eventName = "document_access_removed",
    message = "Your access to this document has been removed.",
  } = {},
) => {
  const roomId = documentId.toString();
  const targetUserId = userId.toString();

  const users = activeUsers.get(roomId) || [];

  const removedUsers = users.filter((user) => user.userId === targetUserId);
  const updatedUsers = users.filter((user) => user.userId !== targetUserId);

  for (const user of removedUsers) {
    const targetSocket = io.sockets.sockets.get(user.socketId);

    if (targetSocket) {
      targetSocket.leave(roomId);

      if (targetSocket.currentDocId === roomId) {
        targetSocket.currentDocId = null;
      }

      targetSocket.emit(eventName, {
        docId: roomId,
        message,
      });
    }
  }

  if (updatedUsers.length === 0) {
    activeUsers.delete(roomId);
  } else {
    activeUsers.set(roomId, updatedUsers);
  }

  io.to(roomId).emit("active_users", {
    docId: roomId,
    users: updatedUsers,
  });
};

// Removes a collaborator and stops their existing sockets from receiving live updates.
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

  try {
    const io = getIO();

    removeUserSocketsFromDocumentRoom(io, documentId, collaborator.user);
  } catch (error) {
    console.error("Failed to remove collaborator sockets:", error);
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Collaborator removed successfully"));
});

// Lists all collaborators for an owner-managed document.
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

// Allows a collaborator to leave a shared document.
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

 try {
  const io = getIO();

  removeUserSocketsFromDocumentRoom(io, documentId, userId, {
    eventName: "document_access_removed",
    message: "You have left this document.",
  });
  } catch (error) {
      console.error("Failed to remove leaving collaborator sockets:", error);
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "You have left the document successfully"));
});

// Updates a collaborator's role after owner authorization.
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

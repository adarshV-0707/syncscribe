import { createVersionCore } from "../../services/versionService.js";
import { socketAuthMiddleware } from "../../middlewares/socket.middleware.js";
import { assertDocumentAccess } from "../assertDocumentAccess.js";

const activeUsers = new Map();

const removeSocketFromActiveUsers = (io, socket, docId) => {
  if (!docId) return;

  const roomId = docId.toString();

  if (!activeUsers.has(roomId)) return;

  const updatedUsers = activeUsers
    .get(roomId)
    .filter((user) => user.socketId !== socket.id);

  if (updatedUsers.length === 0) {
    activeUsers.delete(roomId);
  } else {
    activeUsers.set(roomId, updatedUsers);

    io.to(roomId).emit("active_users", {
      docId: roomId,
      users: updatedUsers,
    });
  }
};

export const initSocketHandler = (io) => {
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id} — user: ${socket.username}`);

    // ─── EVENT: join_document ─────────────────────────────
    socket.on("join_document", async ({ docId }) => {
      try {
        if (!docId) {
          socket.emit("socket_error", {
            event: "join_document",
            message: "docId is required",
          });
          return;
        }

        const roomId = docId.toString();

        // Check whether this user can access the document before joining room
        await assertDocumentAccess(roomId, socket.userId);

        // If this socket was already inside another document room, leave it first
        if (socket.currentDocId && socket.currentDocId !== roomId) {
          socket.leave(socket.currentDocId);
          removeSocketFromActiveUsers(io, socket, socket.currentDocId);
        }

        socket.join(roomId);
        socket.currentDocId = roomId;

        if (!activeUsers.has(roomId)) {
          activeUsers.set(roomId, []);
        }

        // Prevent duplicate active-user entries for same socket
        const existingUsers = activeUsers
          .get(roomId)
          .filter((user) => user.socketId !== socket.id);

        existingUsers.push({
          socketId: socket.id,
          userId: socket.userId.toString(),
          username: socket.username,
        });

        activeUsers.set(roomId, existingUsers);

        io.to(roomId).emit("active_users", {
          docId: roomId,
          users: existingUsers,
        });

        socket.to(roomId).emit("user_joined", {
          docId: roomId,
          userId: socket.userId.toString(),
          username: socket.username,
        });

        socket.emit("document_joined", {
          docId: roomId,
        });
      } catch (err) {
        socket.emit("socket_error", {
          event: "join_document",
          message: err.message || "Failed to join document",
        });
      }
    });

    // ─── EVENT: leave_document ─────────────────────────────
    socket.on("leave_document", ({ docId }) => {
      if (!docId) {
        socket.emit("socket_error", {
          event: "leave_document",
          message: "docId is required",
        });
        return;
      }

      const roomId = docId.toString();

      socket.leave(roomId);
      removeSocketFromActiveUsers(io, socket, roomId);

      if (socket.currentDocId === roomId) {
        socket.currentDocId = null;
      }

      socket.emit("document_left", {
        docId: roomId,
      });
    });

    // ─── EVENT: disconnect ────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);

      const docId = socket.currentDocId;
      if (!docId) return;

      removeSocketFromActiveUsers(io, socket, docId);
    });

    // ─── EVENT: trigger_save ──────────────────────────────
    socket.on(
      "trigger_save",
      async ({ docId, content, label, baseVersionNumber, saveType }) => {
        if (!docId || typeof content !== "string") {
          socket.emit("socket_error", {
            event: "trigger_save",
            message: "docId and content are required",
          });
          return;
        }

        if (baseVersionNumber === undefined || baseVersionNumber === null) {
          socket.emit("socket_error", {
            event: "trigger_save",
            message: "baseVersionNumber is required",
          });
          return;
        }

        try {
          const roomId = docId.toString();

          // Save requires editor access.
          // This is checked every time because role/access may change after room join.
          await assertDocumentAccess(roomId, socket.userId, {
            requireEditor: true,
          });

          const result = await createVersionCore({
            documentId: roomId,
            documentContent: content,
            userId: socket.userId,
            label: label || null,
            baseVersionNumber,
            saveType: saveType || "autosave",
          });

          if (!result.wasConflicted) {
            // Broadcast clean save to everyone except sender
            socket.to(roomId).emit("version_created", {
              docId: roomId,
              versionId: result.savedVersion._id.toString(),
              versionNumber: result.savedVersion.versionNumber,
              type: result.savedVersion.type,
              label: result.savedVersion.label,
              createdBy: result.savedVersion.createdBy.toString(),
              createdAt: result.savedVersion.createdAt,
            });

            socket.to(roomId).emit("document_updated", {
              docId: roomId,
              content,
              versionNumber: result.savedVersion.versionNumber,
              updatedBy: socket.userId.toString(),
              updatedAt: new Date(),
            });

            // Confirm sender only
            socket.emit("save_confirmed", {
              docId: roomId,
              versionId: result.savedVersion._id.toString(),
              versionNumber: result.savedVersion.versionNumber,
              wasConflicted: false,
            });
          } else {
            // Conflict is private to sender only
            socket.emit("conflict_detected", {
              docId: roomId,
              versionId: result.savedVersion._id.toString(),
              yourVersionNumber: result.savedVersion.versionNumber,
              currentContent: result.currentContent,
              yourContent: content,
              basedOnVersion: baseVersionNumber,
              message:
                "Your changes conflicted with recent edits. Your version has been preserved.",
            });
          }
        } catch (err) {
          console.error("trigger_save error:", err);

          socket.emit("socket_error", {
            event: "trigger_save",
            message: err.message || "Save failed",
          });
        }
      },
    );
  });
};
import { createVersionCore } from "../../services/versionService.js";
import { socketAuthMiddleware } from "../../middlewares/socket.middleware.js";

const activeUsers = new Map();

export const initSocketHandler = (io) => {
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id} — user: ${socket.username}`);

    // ─── EVENT: join_document (unchanged) ─────────────────────────────
    socket.on("join_document", ({ docId }) => {
      if (!docId) {
        socket.emit("socket_error", {
          event: "join_document",
          message: "docId is required",
        });
        return;
      }

      socket.join(docId);
      socket.currentDocId = docId;

      if (!activeUsers.has(docId)) {
        activeUsers.set(docId, []);
      }

      activeUsers.get(docId).push({
        socketId: socket.id,
        userId: socket.userId,
        username: socket.username,
      });

      io.to(docId).emit("active_users", {
        docId,
        users: activeUsers.get(docId),
      });

      socket.to(docId).emit("user_joined", {
        userId: socket.userId,
        username: socket.username,
      });
    });

    // ─── EVENT: disconnect (unchanged) ────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);

      const docId = socket.currentDocId;
      if (!docId) return;

      if (activeUsers.has(docId)) {
        const updated = activeUsers
          .get(docId)
          .filter((u) => u.socketId !== socket.id);

        if (updated.length === 0) {
          activeUsers.delete(docId);
        } else {
          activeUsers.set(docId, updated);

          io.to(docId).emit("active_users", {
            docId,
            users: updated,
          });
        }
      }
    });

    // ─── EVENT: trigger_save (REWRITTEN) ──────────────────────────────
    socket.on(
      "trigger_save",
      async ({ docId, content, label, baseVersionNumber, saveType }) => {
        if (!docId || !content) {
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
          const result = await createVersionCore({
            documentId: docId,
            documentContent: content,
            userId: socket.userId,
            label: label || null,
            baseVersionNumber,
            saveType: saveType || "autosave",
          });

          if (!result.wasConflicted) {
            // ── CLEAN SAVE (includes conflict_resolution bypass) ──

            // Broadcast to everyone EXCEPT sender
            socket.to(docId).emit("version_created", {
              docId,
              versionId: result.savedVersion._id,
              versionNumber: result.savedVersion.versionNumber,
              type: result.savedVersion.type,
              label: result.savedVersion.label,
              createdBy: result.savedVersion.createdBy,
              createdAt: result.savedVersion.createdAt,
            });

            socket.to(docId).emit("document_updated", {
              docId,
              content,
              versionNumber: result.savedVersion.versionNumber,
              updatedBy: socket.userId,
              updatedAt: new Date(),
            });

            // Confirm to sender only
            socket.emit("save_confirmed", {
              docId,
              versionNumber: result.savedVersion.versionNumber,
              wasConflicted: false,
            });
          } else {
            // ── CONFLICT — notify sender only, NO broadcast ──

            socket.emit("conflict_detected", {
              docId,
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
import { createVersionCore } from "../../services/versionService.js";
import { socketAuthMiddleware } from "../../middlewares/socket.middleware.js";

const activeUsers = new Map();

export const initSocketHandler = (io) => {
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id} — user: ${socket.username}`);

    // ─── EVENT 1: join_document ───────────────────────────────────────
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

      // EVENT 2: active_users — broadcast to entire room including sender
      io.to(docId).emit("active_users", {
        docId,
        users: activeUsers.get(docId),
      });

      // EVENT 3: user_joined — broadcast to everyone except sender
      socket.to(docId).emit("user_joined", {
        userId: socket.userId,
        username: socket.username,
      });
    });

    // ─── EVENT 4: disconnect (built-in) ──────────────────────────────
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

    // ─── EVENT 5: trigger_save ────────────────────────────────────────
    socket.on("trigger_save", async ({ docId, content, label }) => {
      if (!docId || !content) {
        socket.emit("socket_error", {
          event: "trigger_save",
          message: "docId and content are required",
        });
        return;
      }

      try {
        const savedVersion = await createVersionCore({
          documentId: docId,
          documentContent: content,
          userId: socket.userId,
          label: label || null,
        });

        // EVENT 6: version_created — broadcast to entire room
        io.to(docId).emit("version_created", {
          docId,
          versionId: savedVersion._id,
          versionNumber: savedVersion.versionNumber,
          type: savedVersion.type,
          label: savedVersion.label,
          createdBy: savedVersion.createdBy,
          createdAt: savedVersion.createdAt,
        });

        // EVENT 7: document_updated — broadcast to entire room
        io.to(docId).emit("document_updated", {
          docId,
          content,
          updatedBy: socket.userId,
          updatedAt: new Date(),
        });
      } catch (err) {
        console.error("trigger_save error:", err);

        // EVENT 8: socket_error — only to sender
        socket.emit("socket_error", {
          event: "trigger_save",
          message: err.message || "Save failed",
        });
      }
    });
  });
};

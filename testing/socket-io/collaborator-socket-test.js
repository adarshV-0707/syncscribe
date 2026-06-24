import { io } from "socket.io-client";

const SOCKET_URL = process.env.SOCKET_URL;
const COLLAB_TOKEN = process.env.COLLAB_TOKEN;
const DOCUMENT_ID = process.env.DOCUMENT_ID;

if (!SOCKET_URL || !COLLAB_TOKEN || !DOCUMENT_ID) {
  console.error(
    "Missing required env values: SOCKET_URL, COLLAB_TOKEN, DOCUMENT_ID",
  );
  process.exit(1);
}

const socket = io(SOCKET_URL, {
  auth: {
    token: COLLAB_TOKEN,
  },
});

socket.on("connect", () => {
  console.log("Collaborator connected:", socket.id);

  socket.emit("join_document", {
    docId: DOCUMENT_ID,
  });

  console.log("Collaborator joined document:", DOCUMENT_ID);
});

socket.on("active_users", (payload) => {
  console.log("Active users:", payload);
});

socket.on("document_updated", (payload) => {
  console.log("Document updated received:", payload);
});

socket.on("version_created", (payload) => {
  console.log("Version created received:", payload);
});

socket.on("connect_error", (error) => {
  console.error("Collaborator connection error:", error.message);
});

socket.on("disconnect", (reason) => {
  console.log("Collaborator disconnected:", reason);
});
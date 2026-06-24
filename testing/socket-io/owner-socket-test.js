import { io } from "socket.io-client";

const SOCKET_URL = process.env.SOCKET_URL;
const OWNER_TOKEN = process.env.OWNER_TOKEN;
const DOCUMENT_ID = process.env.DOCUMENT_ID;
const BASE_VERSION = Number(process.env.BASE_VERSION || 1);

if (!SOCKET_URL || !OWNER_TOKEN || !DOCUMENT_ID) {
  console.error(
    "Missing required env values: SOCKET_URL, OWNER_TOKEN, DOCUMENT_ID",
  );
  process.exit(1);
}

const socket = io(SOCKET_URL, {
  auth: {
    token: OWNER_TOKEN,
  },
});

socket.on("connect", () => {
  console.log("Owner connected:", socket.id);

  socket.emit("join_document", {
    docId: DOCUMENT_ID,
  });

  console.log("Owner joined document:", DOCUMENT_ID);

  setTimeout(() => {
    const newContent = `Socket test save at ${new Date().toISOString()}`;

    socket.emit("trigger_save", {
      docId: DOCUMENT_ID,
      content: newContent,
      baseVersionNumber: BASE_VERSION,
      label: "Socket clean save test",
      saveType: "manual",
    });

    console.log("Owner triggered save with content:", newContent);
  }, 2000);
});

socket.on("active_users", (payload) => {
  console.log("Active users:", payload);
});

socket.on("save_confirmed", (payload) => {
  console.log("Save confirmed:", payload);

  setTimeout(() => {
    socket.disconnect();
    process.exit(0);
  }, 1000);
});

socket.on("conflict_detected", (payload) => {
  console.log("Conflict detected:", payload);

  setTimeout(() => {
    socket.disconnect();
    process.exit(1);
  }, 1000);
});

socket.on("connect_error", (error) => {
  console.error("Owner connection error:", error.message);
});

socket.on("disconnect", (reason) => {
  console.log("Owner disconnected:", reason);
});
let io = null;

// Stores the Socket.IO server instance for use outside the main server file.
export const setIO = (ioInstance) => {
  io = ioInstance;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized. Call setIO first.");
  }
  return io;
};

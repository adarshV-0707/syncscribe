const activeUsers = new Map();

// Clears all tracked active users for a document room.
const clearActiveDocumentUsers = (docId) => {
  activeUsers.delete(docId.toString());
};

export { activeUsers, clearActiveDocumentUsers };
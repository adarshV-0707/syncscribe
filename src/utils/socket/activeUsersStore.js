const activeUsers = new Map();

const clearActiveDocumentUsers = (docId) => {
  activeUsers.delete(docId.toString());
};

export { activeUsers, clearActiveDocumentUsers };
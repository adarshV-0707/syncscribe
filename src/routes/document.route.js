import { Router } from "express";
import {
    createDocument,
    getDocument,
    getAllDocuments,
    getSharedDocuments,
    updateDocumentInfo,
    updateDocumentContent,
    deleteDocument,
    restoreDocument,
    archiveDocument,
    getArchivedDocuments,
    getDeletedDocuments,
    togglePublic,
    searchDocument,
    permanentDeleteDocument
} from "../controllers/document.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(verifyJWT);

// ==========================
// 📄 COLLECTION
// ==========================
router.route("/")
    .post(createDocument)
    .get(getAllDocuments);

// ==========================
// 🔍 UTILITY
// ==========================
router.get("/search", searchDocument);

// ==========================
// 📦 FILTERED COLLECTIONS
// ==========================
router.get("/shared", getSharedDocuments);
router.get("/archived", getArchivedDocuments);
router.get("/deleted", getDeletedDocuments);

// ==========================
// 📄 SINGLE DOCUMENT
// ==========================
router.route("/:documentId")
    .get(getDocument)
    .patch(updateDocumentInfo)
    .delete(deleteDocument);

// ==========================
// ✏️ CONTENT
// ==========================
router.patch("/:documentId/content", updateDocumentContent);

// ==========================
// 📦 STATE TRANSITIONS
// ==========================
router.patch("/:documentId/status/archive", archiveDocument);
router.patch("/:documentId/status/restore", restoreDocument);

// ==========================
// 🌍 VISIBILITY
// ==========================
router.patch("/:documentId/visibility", togglePublic);

// ==========================
// 🗑️ PERMANENT DELETE
// ==========================
router.delete("/:documentId/purge", permanentDeleteDocument);

export default router;
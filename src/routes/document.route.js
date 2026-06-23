import { Router } from "express";
import {
  createDocument,
  getDocument,
  getOwnedActiveDocuments,
  getSharedDocuments,
  updateDocumentInfo,
  deleteDocument,
  restoreDocument,
  getDeletedDocuments,
  searchDocument,
  permanentDeleteDocument,
} from "../controllers/document.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(verifyJWT);
// COLLECTION
router.route("/").post(createDocument).get(getOwnedActiveDocuments);


// UTILITY
router.get("/search", searchDocument);

// FILTERED COLLECTIONS
router.get("/shared", getSharedDocuments);
router.get("/deleted", getDeletedDocuments);


// SINGLE DOCUMENT
router
  .route("/:documentId")
  .get(getDocument)
  .delete(deleteDocument);

  router.patch("/:documentId/info", updateDocumentInfo);

  
// STATE TRANSITIONS
router.patch("/:documentId/restore", restoreDocument);

// PERMANENT DELETE
router.delete("/:documentId/purge", permanentDeleteDocument);

export default router;

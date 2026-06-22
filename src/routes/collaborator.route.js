import { Router } from "express";
import {
  removeCollaborator,
  updateCollaboratorRole,
  getCollaborators,
  leaveDocument,
} from "../controllers/collaborator.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

// Get all collaborators for a document
router.get("/:documentId/collaborators", getCollaborators);

// Current logged-in collaborator leaves the document
router.delete("/:documentId/leave", leaveDocument);

// Owner removes a collaborator
router.delete(
  "/:documentId/collaborators/:collaboratorId",
  removeCollaborator,
);

// Owner updates collaborator role
router.patch(
  "/:documentId/collaborators/:userId/role",
  updateCollaboratorRole,
);

export default router;
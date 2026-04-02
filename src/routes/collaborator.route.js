import { Router } from "express"
import {
    addCollaborator,
    removeCollaborator,
    updateCollaboratorRole,
    getCollaborators,
    leaveDocument,
    transferOwnership
} from "../controllers/collaborator.controller.js"
import { verifyJWT } from "../middlewares/auth.middleware.js"

const router = Router()
router.use(verifyJWT)

// ==========================
// 👥 COLLABORATORS
// ==========================
router.route("/:documentId/collaborators")
    .post(addCollaborator)
    .get(getCollaborators)

// ==========================
// 🚪 LEAVE & TRANSFER — static before dynamic
// ==========================
router.delete("/:documentId/collaborators/leave", leaveDocument)
router.patch("/:documentId/collaborators/transfer", transferOwnership)

// ==========================
// 👤 SINGLE COLLABORATOR — dynamic after static
// ==========================
router.delete("/:documentId/collaborators/:collaboratorId", removeCollaborator)
router.patch("/:documentId/collaborators/:userId/role", updateCollaboratorRole)

export default router
import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  listVersions,
  getVersion,
  getContributions,
} from "../controllers/version.controller.js";

const router = Router();

router.use(verifyJWT);

// Version history for a document
router.get("/:documentId/versions", listVersions);

// Owner-only contribution summary
// Must come before /:versionId route
router.get("/:documentId/versions/contributions", getContributions);

// Single version content reconstruction
router.get("/:documentId/versions/:versionId", getVersion);

export default router;
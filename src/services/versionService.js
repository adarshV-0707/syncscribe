import mongoose from "mongoose";
import { Version } from "../models/version.model.js";
import { Document } from "../models/document.model.js";
import { computeDelta } from "../utils/deltaHelpers.js";
import { ApiError } from "../utils/ApiError.js";

const SNAPSHOT_INTERVAL = 10;

export const createVersionCore = async ({
  documentId,
  documentContent,
  userId,
  label,
  baseVersionNumber,
  saveType = "autosave",
}) => {
  if (typeof documentContent !== "string") {
    throw new ApiError(500, "Missing document content for versioning");
  }

  if (baseVersionNumber === undefined || baseVersionNumber === null) {
    throw new ApiError(400, "baseVersionNumber is required for conflict detection");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let savedVersion;
  let wasConflicted = false;
  let currentContent = null;

  try {
    // ─── STEP 1: Atomic CAS on Document ───────────────────────────────
    // Only succeeds if no one else saved since baseVersionNumber
    const casResult = await Document.findOneAndUpdate(
      {
        _id: documentId,
        status: "active",
        latestVersion: baseVersionNumber,
      },
      {
        $inc: { latestVersion: 1 },
        $set: {
          content: documentContent,
          lastEditedBy: userId,
          lastEditedAt: new Date(),
        },
      },
      { new: true, session },
    );

    let newVersionNumber;

    if (casResult) {
      // ─── CLEAN SAVE ──────────────────────────────────────────────────
      newVersionNumber = casResult.latestVersion;
      wasConflicted = false;

    }  else {
      // ─── CONFLICT PATH ────────────────────────────────────────────────
      // Someone else saved. Preserve user's content in version history
      // but DO NOT update Document.content (canonical stays untouched)
      const conflictResult = await Document.findOneAndUpdate(

        { _id: documentId,
          status: "active"
        },

        {
          $inc: { latestVersion: 1 },
          // content NOT updated — canonical stays as-is
        },

        { new: true, session },
      );

      if (!conflictResult) {
        throw new ApiError(404, "Document not found");
      }

      newVersionNumber = conflictResult.latestVersion;
      currentContent = conflictResult.content; // canonical content for client
      wasConflicted = true;
    }

    // ─── STEP 2: Snapshot vs Diff (unchanged logic) ───────────────────
    const isSnapshot = !wasConflicted && (newVersionNumber - 1) % SNAPSHOT_INTERVAL === 0;

    const payload = {
      documentId,
      versionNumber: newVersionNumber,
      type: isSnapshot ? "snapshot" : "diff",
      label: label?.trim() || null,
      createdBy: userId,
      // ── NEW FIELDS ──
      basedOnVersion: baseVersionNumber,
      wasConflicted,
      saveType,
    };

    if (isSnapshot) {
      payload.content = documentContent;
    } else {
      const nearestSnapshot = await Version.findOne({
        documentId,
        type: "snapshot",
        wasConflicted: false,
        versionNumber: { $lt: newVersionNumber },
      })
        .sort({ versionNumber: -1 })
        .select("_id content")
        .session(session)
        .lean();

      if (!nearestSnapshot) {
        // Graceful degradation — promote to snapshot
        payload.type = "snapshot";
        payload.content = documentContent;
      } else {
        payload.delta = computeDelta(nearestSnapshot.content, documentContent);
        payload.snapshotRef = nearestSnapshot._id;
      }
    }

    // ─── STEP 3: Create immutable version record ──────────────────────
    [savedVersion] = await Version.create([payload], { session });

    await session.commitTransaction();
  } 
  
  catch (err) {
    await session.abortTransaction();
    if (err.code === 11000) {
      throw new ApiError(409, "Version conflict — please retry");
    }
    throw err;
  } 
  
  finally {
    session.endSession();
  }

  return {
    savedVersion,
    wasConflicted,
    currentContent, // null on clean save, canonical content on conflict
  };
};
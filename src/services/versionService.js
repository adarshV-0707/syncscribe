import mongoose from "mongoose";
import { Version } from "../models/version.model.js";
import { Document } from "../models/document.model.js";
import { computeDelta } from "../utils/deltaHelpers.js";
import { ApiError } from "../utils/ApiError.js";

const SNAPSHOT_INTERVAL = 10;

//Creates a versioned save using CAS conflict detection and snapshot/diff storage.
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
  // Update the document only if the client saved from the latest known version.
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
      newVersionNumber = casResult.latestVersion;
      wasConflicted = false;

    }  else {
      // If another save already happened, keep canonical content unchanged
      // and store this user's submitted content as a conflicted version.
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

    // Clean saves become periodic snapshots; other versions store diffs from the nearest clean snapshot.
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

      // Store a full snapshot if no previous clean snapshot exists.
      if (!nearestSnapshot) {
        payload.type = "snapshot";
        payload.content = documentContent;
      } else {
        payload.delta = computeDelta(nearestSnapshot.content, documentContent);
        payload.snapshotRef = nearestSnapshot._id;
      }
    }

    // Keep the document version counter and version record atomic.
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
    currentContent, 
  };
};
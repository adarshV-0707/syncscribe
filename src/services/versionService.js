import mongoose from "mongoose";
import { Version } from "../models/version.model.js";
import { Document } from "../models/document.model.js";
import { computeDelta } from "../utils/deltaHelpers.js";
import { ApiError } from "../utils/ApiError.js";

const SNAPSHOT_INTERVAL = 10;

// Pure business logic — no req, no res
// Called by: createVersion controller, socket save_version (socket passes content itself)
export const createVersionCore = async ({
  documentId,
  documentContent,
  userId,
  label,
}) => {
  if (typeof documentContent !== "string") {
    throw new ApiError(500, "Missing document content for versioning");
  }

  const session = await mongoose.startSession();
  let savedVersion;
  session.startTransaction();

  try {
    const versionNumber = await Version.nextVersionNumber(documentId, session);

    const isSnapshot = (versionNumber - 1) % SNAPSHOT_INTERVAL === 0;

    const payload = {
      documentId,
      versionNumber,
      type: isSnapshot ? "snapshot" : "diff",
      label: label?.trim() || null,
      createdBy: userId,
    };

    if (isSnapshot) {
      payload.content = documentContent;
    } else {
      const nearestSnapshot = await Version.findOne({
        documentId,
        type: "snapshot",
        versionNumber: { $lt: versionNumber },
      })
        .sort({ versionNumber: -1 })
        .select("_id content")
        .session(session)
        .lean();

      if (!nearestSnapshot) {
        // Graceful degradation — promote diff to snapshot
        payload.type = "snapshot";
        payload.content = documentContent;
      } else {
        payload.delta = computeDelta(nearestSnapshot.content, documentContent);
        payload.snapshotRef = nearestSnapshot._id;
      }
    }

    [savedVersion] = await Version.create([payload], { session });

    await Document.findByIdAndUpdate(
      documentId,
      { $set: { lastEditedBy: userId } },
      { session },
    );

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    if (err.code === 11000)
      throw new ApiError(409, "Version conflict — please retry");
    throw err;
  } finally {
    session.endSession();
  }

  return savedVersion;
};

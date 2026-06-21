// src/models/version.model.js

import mongoose, { Schema } from "mongoose";

const versionSchema = new Schema(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: [true, "Document reference is required"],
    },
    versionNumber: {
      type: Number,
      required: [true, "Version number is required"],
      min: [1, "Version number must be at least 1"],
    },
    label: {
      // Used as the 'label' in your controller
      type: String,
      trim: true,
      maxlength: [500, "Version message cannot exceed 500 characters"],
      default: null,
    },

    // ─── NEW: Delta/Diff Architecture Fields ───
    type: {
      type: String,
      enum: ["snapshot", "diff"],
      required: [true, "Version type is required"],
    },
    content: {
      type: String,
      // Not required anymore, because 'diff' versions won't have this
    },
    delta: {
      type: String,
      // Stores the patch string from the 'diff' library
    },
    snapshotRef: {
      type: Schema.Types.ObjectId,
      ref: "Version",
      // Points to the base snapshot this delta applies to
    },
    // ───────────────────────────────────────────

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Creator reference is required"],
    },
     // Conflict Detection Fields ───
    basedOnVersion: {
      type: Number,
      default: null,
    },
    wasConflicted: {
      type: Boolean,
      default: false,
    },
    saveType: {
      type: String,
      enum: ["autosave", "manual", "conflict_resolution"],
      default: "autosave",
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // versions are immutable
    versionKey: false,
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Leading field (documentId) handles all document-scoped queries
// unique enforces no duplicate versionNumber per document at DB level
versionSchema.index({ documentId: 1, versionNumber: 1 }, { unique: true });
versionSchema.index({ documentId: 1, type: 1, versionNumber: -1 });

// ─── Immutability Guard ───────────────────────────────────────────────────────

// Block save() on existing documents — only initial creation is allowed
versionSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error(
      "Version documents are immutable — modifications via save() are not allowed.",
    );
  }
});

// Block all update operators at the model level
const BLOCKED_OPS = [
  "findOneAndUpdate",
  "updateOne",
  "updateMany",
  "findByIdAndUpdate",
];

BLOCKED_OPS.forEach((op) => {
  versionSchema.pre(op, function () {
    throw new Error(
      `Version documents are immutable — '${op}' is not allowed.`,
    );
  });
});



export const Version = mongoose.model("Version", versionSchema);

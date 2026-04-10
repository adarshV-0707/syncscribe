// src/models/version.model.js

import mongoose, { Schema } from "mongoose";

const versionSchema = new Schema(
    {
        documentId: {
            type: Schema.Types.ObjectId,
            ref: "Document",
            required: [true, "Document reference is required"],
            // No index: true — compound index below covers documentId-only queries
        },

        versionNumber: {
            type: Number,
            required: [true, "Version number is required"],
            min: [1, "Version number must be at least 1"],
        },

        message: {
            type: String,
            trim: true,
            maxlength: [500, "Version message cannot exceed 500 characters"],
            default: null,
        },

        content: {
            type: String,
            required: [true, "Content snapshot is required"],
        },

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Creator reference is required"],
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false }, // versions are immutable
        versionKey: false,
    }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Leading field (documentId) handles all document-scoped queries
// unique enforces no duplicate versionNumber per document at DB level
versionSchema.index({ documentId: 1, versionNumber: 1 }, { unique: true });


// ─── Immutability Guard ───────────────────────────────────────────────────────

// Block save() on existing documents — only initial creation is allowed
versionSchema.pre("save", function () {
    if (!this.isNew) {
        throw new Error("Version documents are immutable — modifications via save() are not allowed.");
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
        throw new Error(`Version documents are immutable — '${op}' is not allowed.`);
    });
});


// ─── Statics ─────────────────────────────────────────────────────────────────

/**
 * Derives the next version number for a document.
 * Must be called inside the same transaction as Version.create()
 * so the session is propagated and the read + write are atomic.
 *
 * Usage: const next = await Version.nextVersionNumber(documentId, session);
 */
versionSchema.statics.nextVersionNumber = async function (documentId, session) {
    const latest = await this.findOne({ documentId })
        .sort({ versionNumber: -1 })
        .select("versionNumber")
        .session(session ?? null)
        .lean();

    return latest ? latest.versionNumber + 1 : 1;
};

export const Version = mongoose.model("Version", versionSchema);
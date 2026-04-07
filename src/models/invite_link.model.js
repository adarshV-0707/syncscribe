import mongoose, { Schema } from "mongoose"

const inviteLinkSchema = new Schema(
    {
        document: {
            type: Schema.Types.ObjectId,
            ref: "Document",
            required: true
        },
        token: {
            type: String,
            required: true,
            unique: true
        },
        role: {
            type: String,
            enum: ["editor", "viewer"],
            required: true
        },
        maxUses: {
            type: Number,
            default: null ,      // null = unlimited
            min:1,
        },
        usedCount: {
            type: Number,
            default: 0
        },
        expiresAt: {
            type: Date,
            default: null       // null = never expires
        },
        isActive: {
            type: Boolean,
            default: true
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    {
        timestamps: true
    }
)

// ✅ Token lookup — every join hits this
inviteLinkSchema.index({ token: 1 })

// ✅ Document + active — owner managing links
inviteLinkSchema.index({ document: 1, isActive: 1 })



export const InviteLink = mongoose.model("InviteLink", inviteLinkSchema)
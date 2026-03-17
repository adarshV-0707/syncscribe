import mongoose, { Schema } from "mongoose"

const documentSchema = new Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            trim: true
        },
        content: {
            type: String,
            default: ""
        },
        owner: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        isPublic: {
            type: Boolean,
            default: false
        },
        status: {
            type: String,
            enum: ["active", "archived", "deleted"],
            default: "active"
        },
        lastEditedBy: {
            type: Schema.Types.ObjectId,
            ref: "User"
        },
        lastEditedAt: {
            type: Date
        }
    },
    {
        timestamps: true
    }
)

export const Document = mongoose.model("Document", documentSchema)
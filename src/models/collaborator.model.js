import mongoose, { Schema } from "mongoose"

const collaboratorSchema = new Schema(
    {
        document: {
            type: Schema.Types.ObjectId,
            ref: "Document",
            required: true
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        role: {
            type: String,
            enum: ["editor", "viewer"],
            required: true
        },
        invitedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    {
        timestamps: true
    }
)

collaboratorSchema.index({ document: 1, user: 1 }, { unique: true })
collaboratorSchema.index({ user: 1 })

export const Collaborator = mongoose.model("Collaborator", collaboratorSchema)
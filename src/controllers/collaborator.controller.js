import mongoose from 'mongoose'
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ApiResponse } from "../utils/apiResponse.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js"
import { User } from '../models/user.model.js';

const addCollaborator = asyncHandler(async(req, res) => {
    const { documentId } = req.params
    let { email, username, role } = req.body;
    if(!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID")
    }
    email = email?.trim().toLowerCase();
    username = username?.trim().toLowerCase(); 

    if(!email && !username) {
        throw new ApiError(400, "Email or username is required")
    }

    if(!["editor", "viewer"].includes(role)) {
        throw new ApiError(400, "Invalid role. Must be editor or viewer")
    }

    const searchQuery = []
    if(username) searchQuery.push({ username })
    if(email) searchQuery.push({ email })

    const [document, user] = await Promise.all([
        Document.findOne({
            _id: documentId,
            status: "active",
            owner: req.user._id
        }),
        User.findOne({ $or: searchQuery })
    ])

    if(!document) {
        throw new ApiError(404, "Document not found or not authorized")
    }

    if(!user) {
        throw new ApiError(404, "User not found")
    }

    if(user._id.equals(document.owner)) {
        throw new ApiError(400, "Owner cannot be added as collaborator")
    }

    try {
        const collaborator = await Collaborator.create({
            document: documentId,
            user: user._id,
            role,
            invitedBy: req.user._id
        })

        await collaborator.populate([
            { path: "user", select: "name username avatar" },
            { path: "invitedBy", select: "name username avatar" }
        ])

        return res.status(201).json(
            new ApiResponse(201, collaborator, "Collaborator added successfully")
        )
    } catch(error) {
        if(error.code === 11000) {
            throw new ApiError(409, "User is already a collaborator")
        }
        throw error
    }
})

const removeCollaborator = asyncHandler(async(req, res) => {
    const { documentId, collaboratorId } = req.params

    const document = await Document.findOne({
        _id: documentId,
        status: "active",
        owner: req.user._id
    })

    if(!document) {
        throw new ApiError(404, "Document not found or not authorized")
    }

    const collaborator = await Collaborator.findOneAndDelete({
        _id: collaboratorId,
        document: documentId
    })

    if(!collaborator) {
        throw new ApiError(404, "Collaborator not found")
    }

    return res.status(200).json(
        new ApiResponse(200, {}, "Collaborator removed successfully")
    )
})
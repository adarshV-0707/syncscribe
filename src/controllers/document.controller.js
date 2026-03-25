import mongoose from 'mongoose'
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ApiResponse } from "../utils/apiResponse.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js"
import { InviteLink } from "../models/inviteLink.model.js";
import { Version } from "../models/version.model.js";

const createDocument = asyncHandler(async(req, res) => {
    const { title, description } = req.body

    const document = await Document.create({
        title: title?.trim() || "Untitled Document",
        description: description?.trim() || "",
        owner: req.user._id
    })

    return res
    .status(201)
    .json(new ApiResponse(201, document, "Document created successfully"))
})

const getDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID");
    }

    const document = await Document.findOne({
        _id: documentId,
        status: "active"
    })
    .populate("owner", "name username avatar")
    .populate("lastEditedBy", "name username avatar");

    if (!document) {
        throw new ApiError(404, "Document not found");
    }

    const isOwner = document.owner._id.toString() === req.user._id.toString();

    if (!document.isPublic && !isOwner) {
        const collaborator = await Collaborator.findOne({
            document: documentId,
            user: req.user._id
        });

        if (!collaborator) {
            throw new ApiError(403, "User does not have access to this document");
        }

        // Return collaborator role so frontend knows what user can do
        return res.status(200).json(
            new ApiResponse(200, { document, role: collaborator.role }, "Document fetched successfully")
        );
    }

    const role = isOwner ? "owner" : "public"

    return res.status(200).json(
        new ApiResponse(200, { document, role }, "Document fetched successfully")
    );
});

const getAllDocuments = asyncHandler(async(req,res) => {
    const {page = 1 , limit = 10 , search  } = req.query
    const pageNumber = Math.max(Number(page) || 1, 1)
    const limitNumber = Math.min(Number(limit) || 10, 50);
    const query = {
        owner : req.user._id,
        status: "active"
    }
    const searchTerm = search?.trim();
    if(searchTerm){
        query.title = {$regex:searchTerm,$options:"i"}
    }
    const [documents, total] = await Promise.all([
    Document.find(query)
        .sort({ updatedAt: -1 })
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)
        .populate("owner", "name username avatar")
        .lean(),

    Document.countDocuments(query)
    ]);

    return res.status(200)
    .json(
        new ApiResponse(200,{
            documents,
            pagination:{
                total,
                page:pageNumber,
                limit:limitNumber,
                totalPages: Math.ceil(total/limitNumber)
            }
        },"Documents fetched successfully")
    )
        
})

 const getSharedDocuments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;

    const pageNumber = Math.max(Number(page) || 1, 1)
    const limitNumber = Math.min(Number(limit) || 10, 50);

    const documentIds = await Collaborator.distinct("document", {
        user: req.user._id
    });

    let documents = [];
    let total = 0;

    if (documentIds.length > 0) {
        const documentQuery = {
            _id: { $in: documentIds },
            status: "active",
            owner: { $ne: req.user._id }
        };

        [documents, total] = await Promise.all([
            Document.find(documentQuery)
                .populate("owner", "name username avatar")
                .sort({ updatedAt: -1 })
                .skip((pageNumber - 1) * limitNumber)
                .limit(limitNumber)
                .lean(),

            Document.countDocuments(documentQuery)
        ]);
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                documents,
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    totalPages: Math.ceil(total / limitNumber)
                }
            },
            documents.length === 0 ? "No shared documents found" : "Shared documents fetched successfully"
        )
    );
});

const updateDocumentInfo = asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const [newTitle, newDescription] = [req.body.newTitle, req.body.newDescription].map(f => f?.trim());

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID");
    }

    if (!newTitle && !newDescription) {
        throw new ApiError(400, "At least one field is required to update");
    }

    const document = await Document.findById(documentId);

    if (!document || document.status !== "active" ) {
        throw new ApiError(404, "Document not found");
    }

    const isOwner = document.owner.equals(req.user._id);
    if (!isOwner) {
        const isEditor = await Collaborator.exists({
            document: documentId,
            user: req.user._id,
            role: { $in: ["editor"] }
        });

        if (!isEditor) {
            throw new ApiError(403, "Viewers are not allowed to update the document");
        }
    }

    const updateFields = {};
    if (newTitle) updateFields.title = newTitle;
    if (newDescription) updateFields.description = newDescription;
    updateFields.lastEditedBy = req.user._id;
    updateFields.lastEditedAt = new Date();

    const updatedDocument = await Document.findByIdAndUpdate(
        documentId,
        { $set: updateFields },
        { new: true, runValidators: true }
    )
    .populate("owner", "name username avatar")
    .populate("lastEditedBy", "name username avatar");

    return res.status(200).json(
        new ApiResponse(200, updatedDocument, "Document info updated successfully")
    );
});

const updateDocumentContent = asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const { content } = req.body;

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID");
    }

    if (!content?.trim()) {
        throw new ApiError(400, "Content is required");
    }

    const document = await Document.findById(documentId);

    if (!document || document.status !== "active") {
        throw new ApiError(404, "Document not found");
    }

    const isOwner = document.owner.equals(req.user._id);
    if (!isOwner) {
        const isEditor = await Collaborator.exists({
            document: documentId,
            user: req.user._id,
            role: { $in: ["editor"] }
        });

        if (!isEditor) {
            throw new ApiError(403, "Viewers are not allowed to update the document");
        }
    }

    const updatedDocument = await Document.findByIdAndUpdate(
        documentId,
        {
            $set: {
                content,
                lastEditedBy: req.user._id,
                lastEditedAt: new Date(),
            }
        },
        { new: true, runValidators: true }
    )
    .populate("owner", "name username avatar")
    .populate("lastEditedBy", "name username avatar");

    return res.status(200).json(
        new ApiResponse(200, updatedDocument, "Document content updated successfully")
    );
});

const deleteDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    
    if (!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID");
    }

    const deletedDocument = await Document.findOneAndUpdate(
        {
            _id: documentId,
            status: { $ne: "deleted" },
            owner: req.user._id
        },
        {
            $set: { status: "deleted" }
        },
        { new: true }
    );

    if (!deletedDocument) {
        throw new ApiError(404, "Document not found or not authorized");
    }

    return res.status(200).json(
        new ApiResponse(200, {} , "Document deleted successfully")
    );
});

const restoreDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID");
    }

    const restoredDocument = await Document.findOneAndUpdate(
        {
            _id: documentId,
            status: { $in: ["deleted", "archived"] },
            owner: req.user._id
        },
        {
            $set: { status: "active" }
        },
        { new: true }
    );

    if (!restoredDocument) {
        throw new ApiError(404, "Document not found or not authorized");
    }

    return res.status(200).json(
        new ApiResponse(200, restoredDocument, "Document restored successfully")
    );
});

const archiveDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID");
    }

    const archivedDocument = await Document.findOneAndUpdate(
        {
            _id: documentId,
            status: "active",
            owner: req.user._id
        },
        {
            $set: { status: "archived" }
        },
        { new: true }
    );

    if (!archivedDocument) {
        throw new ApiError(404, "Document not found or not authorized");
    }

    return res.status(200).json(
        new ApiResponse(200, archivedDocument, "Document archived successfully")
    );
});

const getArchivedDocuments = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(Number(limit) || 10, 50);

    const query = {
        owner: req.user._id,
        status: "archived"
    };

    const [documents, total] = await Promise.all([
        Document.find(query)
            .sort({ updatedAt: -1 })
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber)
            .lean(),
        Document.countDocuments(query)
    ]);

    return res.status(200).json(
        new ApiResponse(200, {
            documents,
            pagination: {
                total,
                page: pageNumber,
                limit: limitNumber,
                totalPages: Math.ceil(total / limitNumber)
            }
        }, total === 0 ? "No archived documents found" : "Archived documents fetched successfully")
    );
});

const getDeletedDocuments = asyncHandler(async(req, res) => {
    const { page = 1, limit = 10 } = req.query

    const pageNumber = Math.max(Number(page) || 1, 1)
    const limitNumber = Math.min(Number(limit) || 10, 50)

    const query = {
        owner: req.user._id,
        status: "deleted"
    }

    const [documents, total] = await Promise.all([
        Document.find(query)
            .sort({ updatedAt: -1 })
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber)
            .lean(),
        Document.countDocuments(query)
    ])

    return res.status(200).json(
        new ApiResponse(200, {
            documents,
            pagination: {
                total,
                page: pageNumber,
                limit: limitNumber,
                totalPages: Math.ceil(total / limitNumber)
            }
        }, total === 0 ? "No deleted documents found" : "Deleted documents fetched successfully")
    )
})

const togglePublic = asyncHandler(async(req, res) => {
    const { documentId } = req.params

    if(!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID")
    }

    const updatedDocument = await Document.findOneAndUpdate(
        {
            _id: documentId,
            owner: req.user._id,
            status: "active"
        },
        [
            {
                $set: {
                    isPublic: { $not: "$isPublic" }
                }
            }
        ],
        { new: true }
    )

    if(!updatedDocument) {
        throw new ApiError(404, "Document not found or not authorized")
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedDocument,
            `Document is now ${updatedDocument.isPublic ? "public" : "private"}`
        )
    )
})

const searchDocument = asyncHandler(async (req, res) => {
    const { query, page = 1, limit = 10 } = req.query

    if (!query?.trim()) {
        throw new ApiError(400, "Search query is required")
    }

    const pageNumber = Math.max(Number(page) || 1, 1)
    const limitNumber = Math.min(Number(limit) || 10, 50)

    const sharedDocIds = await Collaborator.distinct("document", {
        user: req.user._id
    })

    const searchQuery = {
        status: "active",
        $or: [
            { owner: req.user._id },
            { _id: { $in: sharedDocIds } }
        ],
        title: { $regex: query.trim(), $options: "i" }
    }

    const [documents, total] = await Promise.all([
        Document.find(searchQuery)
            .sort({ updatedAt: -1 })
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber)
            .lean(),
        Document.countDocuments(searchQuery)
    ])

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                documents,
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    totalPages: Math.ceil(total / limitNumber)
                }
            },
            total === 0 ? "No documents found" : "Documents fetched successfully"
        )
    )
})

const permanentDeleteDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
        throw new ApiError(400, "Invalid document ID");
    }

    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const document = await Document.findOneAndDelete(
            {
                _id: documentId,
                owner: req.user._id,
                status: "deleted"
            },
            { session }
        );

        if (!document) {
            throw new ApiError(404, "Document not found or not authorized for permanent deletion");
        }

        await Promise.all([
            Collaborator.deleteMany({ document: documentId }, { session }),
            InviteLink.deleteMany({ document: documentId }, { session }),
            Version.deleteMany({ document: documentId }, { session }),
        ]);

        await session.commitTransaction();

        return res.status(200).json(
            new ApiResponse(200, {}, "Document permanently deleted successfully")
        );

    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
});

export {
    createDocument,
    getDocument,
    getAllDocuments,
    getSharedDocuments,
    updateDocumentInfo,
    updateDocumentContent,
    deleteDocument,
    restoreDocument,
    archiveDocument,
    getArchivedDocuments,
    getDeletedDocuments,
    togglePublic,
    searchDocument,
    permanentDeleteDocument
}






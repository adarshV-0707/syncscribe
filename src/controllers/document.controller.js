import mongoose from 'mongoose'
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js"
import { InviteLink } from "../models/inviteLink.model.js";
import { Version } from "../models/version.model.js";
import { applyDelta } from "../utils/deltaHelpers.js";
import { assertDocumentAccess } from "../utils/assertDocumentAccess.js";
import { createVersionCore } from "../services/versionService.js";
import { getIO } from "../socket/socketInstance.js"

const createDocument = asyncHandler(async (req, res) => {
    const { title, description } = req.body;

    const document = await Document.create({
        title: title?.trim() || "Untitled Document",
        description: description?.trim() || "",
        content: "", // Explicitly setting the DB baseline
        owner: req.user._id,
        lastEditedBy: req.user._id
    });

    // Records Zero State — guarantees blank document is always restorable.
    // Version 1 is a snapshot by formula: (1-1) % 10 === 0.
    // We pass the content ("") to respect the optimized Service contract.
    await createVersionCore({
        documentId: document._id,
        documentContent: document.content, // Fulfils the service requirement!
        userId: req.user._id,
        label: "Initial Draft"
    });

    return res
        .status(201)
        .json(new ApiResponse(201, document, "Document created successfully"));
});

const getDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    
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

    if (content === undefined || content === null)
    throw new ApiError(400, "Content is required");

    // Select only what permission check needs — not the full document
    const document = await Document.findOne({
        _id: documentId,
        status: "active",
    })
        .select("owner")
        .lean();                          // plain object, no Mongoose overhead

    if (!document) throw new ApiError(404, "Document not found");

    if (!document.owner.equals(req.user._id)) {
        const isEditor = await Collaborator.exists({
            document: documentId,
            user: req.user._id,
            role: "editor",              // exists() is already a boolean check
        });

        if (!isEditor)
            throw new ApiError(403, "Viewers are not allowed to update the document");
    }

    // Update only — no return value needed, client already has the document
    await Document.findByIdAndUpdate(
        documentId,
        {
            $set: {
                content,
                lastEditedBy: req.user._id,
                lastEditedAt: new Date(),
            },
        },
    );

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Content saved"));
});

const deleteDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;


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
    const { documentId } = req.params;

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

// documentController.js
const restoreVersion = asyncHandler(async (req, res) => {
    const { documentId, versionId } = req.params;
    const userId = req.user._id;

    await assertDocumentAccess(documentId, userId, { requireEditor: true });

    const version = await Version.findOne({ _id: versionId, documentId })
        .select("type content delta snapshotRef versionNumber label")
        .lean();

    if (!version) throw new ApiError(404, "Version not found");

    let restoredContent;

    if (version.type === "snapshot") {
        restoredContent = version.content;
    } else {
        if (!version.snapshotRef)
            throw new ApiError(
                500,
                "Diff version is missing snapshot reference",
            );

        const snapshot = await Version.findOne({
            _id: version.snapshotRef,
            documentId,
            type: "snapshot",
        })
            .select("content")
            .lean();

        if (!snapshot)
            throw new ApiError(
                500,
                "Referenced snapshot not found — version chain is broken",
            );

        restoredContent = applyDelta(snapshot.content, version.delta);
    }

    const session = await mongoose.startSession();
    let savedVersion;
    session.startTransaction();

    try {
        const versionNumber = await Version.nextVersionNumber(
            documentId,
            session,
        );

        // Reflect original label in restore label if it existed
        const restoreLabel = version.label
            ? `Restored from v${version.versionNumber} — ${version.label}`
            : `Restored from v${version.versionNumber}`;

        [savedVersion] = await Version.create(
            [
                {
                    documentId,
                    versionNumber,
                    type: "snapshot",
                    content: restoredContent,
                    label: restoreLabel,
                    createdBy: userId,
                },
            ],
            { session },
        );

        await Document.findByIdAndUpdate(
            documentId,
            {
                content: restoredContent,
                lastEditedBy: userId,
            },
            { session },
        );

        await session.commitTransaction();
        const io = getIO()

        // EVENT: document_restored — tells clients to replace editor content
        io.to(documentId).emit("document_restored", {
            docId: documentId,
            content: restoredContent,
            restoredBy: userId,
            versionNumber: savedVersion.versionNumber,
            label: savedVersion.label,
            restoredAt: new Date()
        })

        // EVENT: version_created — tells clients to update version history panel
        io.to(documentId).emit("version_created", {
            docId: documentId,
            versionId: savedVersion._id,
            versionNumber: savedVersion.versionNumber,
            type: savedVersion.type,
            label: savedVersion.label,
            createdBy: savedVersion.createdBy,
            createdAt: savedVersion.createdAt
        })
    }
     catch (err) {
        await session.abortTransaction();
        if (err.code === 11000)
            throw new ApiError(409, "Version conflict — please retry");
        throw err;
    } 
    
    finally {
        session.endSession();
    }

    const responseData = {
        _id: savedVersion._id,
        documentId: savedVersion.documentId,
        versionNumber: savedVersion.versionNumber,
        type: savedVersion.type,
        label: savedVersion.label,
        createdBy: {
            _id: req.user._id,
            name: req.user.name,
            username: req.user.username,
        },
        createdAt: savedVersion.createdAt,
    };

    return res
        .status(201)
        .json(
            new ApiResponse(201, responseData, "Version restored successfully"),
        );
});

const permanentDeleteDocument = asyncHandler(async (req, res) => {
    const { documentId } = req.params;
    const userId = req.user._id;

    // Must exist, must be owner, must already be soft-deleted
    const document = await Document.findOne({
        _id: documentId,
        owner: userId,
        status: "deleted",
    })
        .select("_id")
        .lean();

    if (!document) throw new ApiError(404, "Document not found or not eligible for permanent deletion");

    const session = await mongoose.startSession();
    session.startTransaction(); // outside try — synchronous, never throws

    try {
        // Dependents first — all in parallel, same session
        await Promise.all([
            Version.deleteMany({ documentId }, { session }),
            Collaborator.deleteMany({ document: documentId }, { session }),
            InviteLink.deleteMany({ document: documentId }, { session }),
        ]);

        // Parent last — only after dependents are gone
        await Document.findOneAndDelete(
            { _id: documentId, owner: userId },
            { session }
        );

        await session.commitTransaction();

        return res.status(200).json(
            new ApiResponse(200, {}, "Document permanently deleted")
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
    restoreVersion,
    permanentDeleteDocument
}






import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { ApiResponse } from "../utils/apiResponse.js";
import { Document } from "../models/document.model.js";

const createDocument = asyncHandler(async(req, res) => {
    const { title, description } = req.body

    const document = await Document.create({
        title: title?.trim() || "Untitled Document",
        description: description?.trim() || "",
        owner: req.user._id
    })

    if(!document) {
        throw new ApiError(500, "Something went wrong while creating document")
    }

    return res
    .status(201)
    .json(new ApiResponse(201, document, "Document created successfully"))
})

const getDocument = asyncHandler(async(req,res) => {
   const {documentId} = req.params
   if(!mongoose.Types.ObjectId.isValid(documentId)) {
    throw new ApiError(400, "Invalid document id")
}
   const document = await Document.findById(documentId)
   
   if(!document || document.status === "deleted"){
    throw new ApiError(404,"Document not found")
   }
   const isOwner = document.owner.toString() === req.user._id.toString()

   const isPublic = document.isPublic

   if(!isPublic && !isOwner){
    const collaborator = await Collaborator.findOne({
        document: documentId,
        user:req.user._id
    }

    )
    if(!collaborator){
        throw new ApiError(403,"User does not have access to this document")
    }
    }
    await Document.populate(document, [
    { path: "owner", select: "name username avatar" },
    { path: "lastEditedBy", select: "name username avatar" }
    ]);
    
    return res
    .status(200)
    .json(new ApiResponse(200,document,"Document fetched successfully")) 

})

const getAllDocuments = asyncHandler(async(req,res) => {
    const {page = 1 , limit = 10 , search , status } = req.query
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;
    const query = {
        owner : req.user._id,
        status: status && status !== "deleted" ? status : { $ne: "deleted" }
    }
    if(search){
        query.title = {$regex:search,$options:"i"}
    }
    const [documents, total] = await Promise.all([
    Document.find(query)
        .sort({ updatedAt: -1 })
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber),

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

    const pageNumber = Number(page) || 1;
    const limitNumber = Math.min(Number(limit) || 10, 50);

    const collaborations = await Collaborator.find({
        user: req.user._id
    }).select("document").lean();

    const documentIds = collaborations.map(c => c.document);

    let documents = []
    let total = 0

    if(documentIds.length > 0) {
        const documentQuery = {
            _id: { $in: documentIds },
            status: { $ne: "deleted" },
            owner: {$ne:req.user._id}
        }

        ;[documents, total] = await Promise.all([
            Document.find(documentQuery)
            .populate("owner", "name username avatar")
            .sort({ updatedAt: -1 })
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber)
            .lean(),

            Document.countDocuments(documentQuery)
        ])
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
    )
})

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
            role: { $in: ["editor", "leader"] }
        });

        if (!isEditor) {
            throw new ApiError(403, "You are not authorized to update this document");
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

    if (!content) {
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
            throw new ApiError(403, "You are not authorized to update this document");
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
        new ApiResponse(200, deletedDocument, "Document deleted successfully")
    );
});




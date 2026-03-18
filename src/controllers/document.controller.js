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
    
})
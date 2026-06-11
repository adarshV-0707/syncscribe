import { ApiError } from "./ApiError.js";
import { Document } from "../models/document.model.js";
import { Collaborator } from "../models/collaborator.model.js";

export const assertDocumentAccess = async (
    documentId,
    userId,
    { requireEditor = false, selectFields = "" } = {},
) => {
    const document = await Document.findOne({
        _id: documentId,
        status: "active",
    })
        .select(`owner ${selectFields}`.trim())
        .lean();

    if (!document) throw new ApiError(404, "Document not found");

    if (document.owner.equals(userId)) return document;

    const query = { document: documentId, user: userId };
    if (requireEditor) query.role = "editor";

    const collaborator = await Collaborator.findOne(query)
        .select("_id")
        .lean();

    if (!collaborator)
        throw new ApiError(
            403,
            requireEditor ? "Editor access required" : "Access denied",
        );

    return document;
};
import { createPatch, applyPatch } from "diff";
import { ApiError } from "./ApiError.js";

export const computeDelta = (base, head) =>
    createPatch("document", base, head);

export const applyDelta = (base, delta) => {
    const result = applyPatch(base, delta);
    if (result === false)
        throw new ApiError(
            500,
            "Version reconstruction failed — delta is corrupt",
        );
    return result;
};
import jwt from "jsonwebtoken"
import { User } from "../models/user.model.js"

export const socketAuthMiddleware = async (socket, next) => {
    try {
        const raw = socket.handshake.auth?.token

        if (!raw) {
            return next(new Error("Authentication token missing"))
        }

        const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw

        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)

        const user = await User.findById(decoded._id)
            .select("_id username email")
            .lean()

        if (!user) {
            return next(new Error("User not found"))
        }

        socket.userId = user._id
        socket.username = user.username

        next()

    } catch (err) {
        if (err.name === "TokenExpiredError") {
            return next(new Error("Token expired"))
        }
        if (err.name === "JsonWebTokenError") {
            return next(new Error("Invalid token"))
        }
        return next(new Error("Authentication failed"))
    }
}
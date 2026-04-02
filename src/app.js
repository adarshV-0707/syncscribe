import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import morgan from 'morgan'
import userRouter from './routes/user.routes.js'
import documentRouter from './routes/document.routes.js'
import collaboratorRouter from './routes/collaborator.routes.js'


const app = express()

app.use(helmet())
app.use(morgan('dev'))
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}))

app.use(express.json({ limit: "16kb" }))
app.use(express.urlencoded({ extended: true, limit: '16kb' }))
app.use(express.static("public"))
app.use(cookieParser())

app.use("/api/v1/users", userRouter)
app.use("/api/v1/documents", documentRouter)
app.use("/api/v1/documents", collaboratorRouter)

app.use((err, req, res, next) => {
    // ✅ Handle invalid MongoDB ID format globally
    if(err.name === "CastError") {
        return res.status(400).json({
            success: false,
            statusCode: 400,
            message: "Invalid ID format",
            errors: [],
            data: null
        })
    }

    const statusCode = err.statusCode || 500
    const message = err.message || "Something went wrong"

    return res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        errors: err.errors || [],
        data: null
    })
})

export { app }
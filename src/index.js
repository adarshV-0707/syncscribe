import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import { app } from "./app.js";
import { setIO } from "./utils/socket/socketInstance.js";
import { initSocketHandler } from "./utils/socket/socketHandler.js";

dotenv.config({
  path: "./.env",
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  },
});

setIO(io);
initSocketHandler(io);

connectDB()
  .then(() => {
    httpServer.listen(process.env.PORT || 5000, () => {
      console.log(`Server is running at port: ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("MONGO db connection failed!!", err);
  });

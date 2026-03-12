import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { createServer } from "http";
import { Server } from "socket.io";
import { setupGameSocket } from "./game/gameHandler";

const app: Express = express();

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export const httpServer = createServer(app);

export const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

setupGameSocket(io);

export default app;

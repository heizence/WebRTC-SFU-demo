import express from "express";
import http from "http";
import path from "path";
import { logger } from "./utils/logger";
import { workerPool } from "./mediasoup/worker-pool";
import { roomManager } from "./mediasoup/room-manager";
import { initializeSocketIO } from "./socket/socket-handler";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// 정적 파일 제공 (클라이언트)
app.use(express.static(path.join(__dirname, "../dist/public")));

// 헬스체크
app.get("/health", (_req, res) => {
  const workerStats = workerPool.getWorkerStats();
  const roomStats = roomManager.getRoomStats();
  const totalPeers = roomManager.getTotalPeerCount();

  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    workers: workerStats,
    rooms: {
      count: roomStats.length,
      totalPeers,
      details: roomStats,
    },
  });
});

async function startServer() {
  try {
    // mediasoup Worker Pool 초기화
    await workerPool.initialize();

    // Socket.io 초기화
    initializeSocketIO(server);
    logger.info("Socket.io initialized");

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, closing server...");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

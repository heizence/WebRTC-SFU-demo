import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { roomManager } from "../mediasoup/room-manager";
import { logger } from "../utils/logger";

export function initializeSocketIO(httpServer: HTTPServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*", // 개발 환경용, 프로덕션에서는 특정 도메인 지정
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket: Socket) => {
    logger.info("Client connected", { socketId: socket.id });

    // 방 생성
    socket.on("create-room", async (callback) => {
      try {
        const { roomId, router } = await roomManager.createRoom();

        logger.info("Room created via socket", {
          roomId,
          socketId: socket.id,
          routerRtpCapabilities: router.rtpCapabilities,
        });

        callback({
          success: true,
          roomId,
          rtpCapabilities: router.rtpCapabilities,
        });
      } catch (error) {
        logger.error("Failed to create room", { error, socketId: socket.id });
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // 방 입장
    socket.on("join-room", async ({ roomId, nickname }, callback) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) {
          callback({
            success: false,
            error: "Room not found",
          });
          return;
        }

        // Socket.io Room에 join
        socket.join(roomId);

        // Peer 추가
        const peerId = socket.id; // socketId를 peerId로 사용
        const peer = roomManager.addPeer(roomId, peerId, socket.id, nickname);

        logger.info("Peer joined room", {
          roomId,
          peerId,
          nickname,
          currentPeers: room.peers.size,
        });

        // 기존 peer들에게 새 peer 알림
        socket.to(roomId).emit("peer-joined", {
          peerId,
          nickname,
        });

        // 새 peer에게 기존 peer 목록 전달
        const existingPeers = Array.from(room.peers.values())
          .filter((p) => p.id !== peerId)
          .map((p) => ({
            peerId: p.id,
            nickname: p.nickname,
          }));

        callback({
          success: true,
          peerId,
          rtpCapabilities: room.router.rtpCapabilities,
          peers: existingPeers,
        });
      } catch (error) {
        logger.error("Failed to join room", { error, roomId, socketId: socket.id });
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // 방 나가기
    socket.on("leave-room", ({ roomId }) => {
      handlePeerLeave(socket, roomId);
    });

    // 연결 해제
    socket.on("disconnect", () => {
      logger.info("Client disconnected", { socketId: socket.id });

      // 모든 방에서 해당 peer 제거
      const rooms = roomManager.getRoomStats();
      rooms.forEach((roomStat) => {
        const room = roomManager.getRoom(roomStat.roomId);
        if (room && room.peers.has(socket.id)) {
          handlePeerLeave(socket, roomStat.roomId);
        }
      });
    });

    // Transport 생성 (기존 disconnect 이벤트 위에 추가)
    socket.on("create-transport", async ({ roomId, direction }, callback) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) {
          callback({ success: false, error: "Room not found" });
          return;
        }

        const peer = roomManager.getPeer(roomId, socket.id);
        if (!peer) {
          callback({ success: false, error: "Peer not found" });
          return;
        }

        // WebRTC Transport 생성
        const transport = await room.router.createWebRtcTransport({
          listenIps: [
            {
              ip: "0.0.0.0",
              announcedIp: process.env.ANNOUNCED_IP || "127.0.0.1",
            },
          ],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });

        // Transport 저장
        peer.transports.set(transport.id, transport);

        logger.info("Transport created", {
          roomId,
          peerId: socket.id,
          transportId: transport.id,
          direction,
        });

        callback({
          success: true,
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });
      } catch (error) {
        logger.error("Failed to create transport", { error, roomId, socketId: socket.id });
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Transport 연결 (ICE/DTLS)
    socket.on("connect-transport", async ({ roomId, transportId, dtlsParameters }, callback) => {
      try {
        const peer = roomManager.getPeer(roomId, socket.id);
        if (!peer) {
          callback({ success: false, error: "Peer not found" });
          return;
        }

        const transport = peer.transports.get(transportId);
        if (!transport) {
          callback({ success: false, error: "Transport not found" });
          return;
        }

        await transport.connect({ dtlsParameters });

        logger.info("Transport connected", {
          roomId,
          peerId: socket.id,
          transportId,
        });

        callback({ success: true });
      } catch (error) {
        logger.error("Failed to connect transport", { error, roomId, transportId });
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Producer 생성 (송신)
    socket.on("produce", async ({ roomId, transportId, kind, rtpParameters }, callback) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) {
          callback({ success: false, error: "Room not found" });
          return;
        }

        const peer = roomManager.getPeer(roomId, socket.id);
        if (!peer) {
          callback({ success: false, error: "Peer not found" });
          return;
        }

        const transport = peer.transports.get(transportId);
        if (!transport) {
          callback({ success: false, error: "Transport not found" });
          return;
        }

        const producer = await transport.produce({
          kind,
          rtpParameters,
        });

        // Producer 저장
        peer.producers.set(producer.id, producer);

        logger.info("Producer created", {
          roomId,
          peerId: socket.id,
          producerId: producer.id,
          kind,
        });

        // 다른 peer들에게 새 Producer 알림
        socket.to(roomId).emit("new-producer", {
          peerId: socket.id,
          producerId: producer.id,
          kind,
        });

        callback({
          success: true,
          id: producer.id,
        });
      } catch (error) {
        logger.error("Failed to produce", { error, roomId, transportId });
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Consumer 생성 (수신)
    socket.on("consume", async ({ roomId, transportId, producerId, rtpCapabilities }, callback) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) {
          callback({ success: false, error: "Room not found" });
          return;
        }

        const peer = roomManager.getPeer(roomId, socket.id);
        if (!peer) {
          callback({ success: false, error: "Peer not found" });
          return;
        }

        const transport = peer.transports.get(transportId);
        if (!transport) {
          callback({ success: false, error: "Transport not found" });
          return;
        }

        // Router가 이 RTP Capabilities를 지원하는지 확인
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          callback({ success: false, error: "Cannot consume" });
          return;
        }

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true, // 처음엔 pause 상태로 생성
        });

        // Consumer 저장
        peer.consumers.set(consumer.id, consumer);

        logger.info("Consumer created", {
          roomId,
          peerId: socket.id,
          consumerId: consumer.id,
          producerId,
        });

        callback({
          success: true,
          params: {
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          },
        });
      } catch (error) {
        logger.error("Failed to consume", { error, roomId, producerId });
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Consumer Resume (재생 시작)
    socket.on("resume-consumer", async ({ roomId, consumerId }, callback) => {
      try {
        const peer = roomManager.getPeer(roomId, socket.id);
        if (!peer) {
          callback({ success: false, error: "Peer not found" });
          return;
        }

        const consumer = peer.consumers.get(consumerId);
        if (!consumer) {
          callback({ success: false, error: "Consumer not found" });
          return;
        }

        await consumer.resume();

        logger.info("Consumer resumed", {
          roomId,
          peerId: socket.id,
          consumerId,
        });

        callback({ success: true });
      } catch (error) {
        logger.error("Failed to resume consumer", { error, roomId, consumerId });
        callback({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  });

  return io;
}

function handlePeerLeave(socket: Socket, roomId: string) {
  const peerId = socket.id;

  logger.info("Peer leaving room", { roomId, peerId });

  // Socket.io Room에서 나가기
  socket.leave(roomId);

  // Peer 제거
  roomManager.removePeer(roomId, peerId);

  // 다른 peer들에게 알림
  socket.to(roomId).emit("peer-left", { peerId });
}

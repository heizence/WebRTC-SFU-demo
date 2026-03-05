import { Router } from "mediasoup/node/lib/types";
import { workerPool } from "./worker-pool";
import { Room, Peer } from "../types/room.types";
import { logger } from "../utils/logger";
import { randomUUID } from "crypto"; // uuid 대신 crypto 사용

class RoomManager {
  private rooms: Map<string, Room> = new Map();

  async createRoom(): Promise<{ roomId: string; router: Router }> {
    const roomId = randomUUID();
    const { worker, workerId } = workerPool.getWorker();

    // Router 생성
    const router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "42e01f",
            "level-asymmetry-allowed": 1,
          },
        },
      ],
    });

    const room: Room = {
      id: roomId,
      router,
      workerId,
      peers: new Map(),
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    workerPool.incrementRoomCount(workerId);

    logger.info(`Room created`, { roomId, workerId });

    return { roomId, router };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  async deleteRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) {
      logger.warn(`Attempted to delete non-existent room`, { roomId });
      return;
    }

    // 모든 peer 정리
    for (const [peerId] of room.peers) {
      this.removePeer(roomId, peerId);
    }

    // Router 닫기
    room.router.close();

    // Worker room count 감소
    workerPool.decrementRoomCount(room.workerId);

    this.rooms.delete(roomId);
    logger.info(`Room deleted`, { roomId, workerId: room.workerId });
  }

  addPeer(roomId: string, peerId: string, socketId: string, nickname: string): Peer {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} does not exist`);
    }

    const peer: Peer = {
      id: peerId,
      socketId,
      nickname,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };

    room.peers.set(peerId, peer);
    logger.info(`Peer added to room`, { roomId, peerId, nickname });

    return peer;
  }

  removePeer(roomId: string, peerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const peer = room.peers.get(peerId);
    if (!peer) {
      return;
    }

    // 모든 Transport/Producer/Consumer 정리
    peer.transports.forEach((transport) => transport.close());
    peer.producers.forEach((producer) => producer.close());
    peer.consumers.forEach((consumer) => consumer.close());

    room.peers.delete(peerId);
    logger.info(`Peer removed from room`, { roomId, peerId });

    // 방이 비었으면 삭제
    if (room.peers.size === 0) {
      this.deleteRoom(roomId);
    }
  }

  getPeer(roomId: string, peerId: string): Peer | undefined {
    const room = this.rooms.get(roomId);
    return room?.peers.get(peerId);
  }

  getRoomStats() {
    return Array.from(this.rooms.values()).map((room) => ({
      roomId: room.id,
      workerId: room.workerId,
      peerCount: room.peers.size,
      createdAt: room.createdAt,
    }));
  }

  getTotalPeerCount(): number {
    let total = 0;
    this.rooms.forEach((room) => {
      total += room.peers.size;
    });
    return total;
  }
}

export const roomManager = new RoomManager();

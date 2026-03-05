import { Router, Transport, Producer, Consumer } from "mediasoup/node/lib/types";

export interface Peer {
  id: string;
  socketId: string;
  nickname: string;
  transports: Map<string, Transport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

export interface Room {
  id: string;
  router: Router;
  workerId: number;
  peers: Map<string, Peer>;
  createdAt: Date;
}

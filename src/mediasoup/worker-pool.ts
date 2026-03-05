import * as mediasoup from "mediasoup";
import { Worker } from "mediasoup/node/lib/types";
import os from "os";
import { logger } from "../utils/logger";

interface WorkerInfo {
  worker: Worker;
  roomCount: number;
}

class WorkerPool {
  private workers: WorkerInfo[] = [];
  private nextWorkerIdx = 0;

  async initialize() {
    const numWorkers = os.cpus().length;
    logger.info(`Initializing mediasoup with ${numWorkers} workers`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: "warn",
        logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
        rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT) || 40000,
        rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 40100,
      });

      worker.on("died", () => {
        logger.error(`Worker ${i} died, exiting in 2 seconds...`);
        setTimeout(() => process.exit(1), 2000);
      });

      this.workers.push({
        worker,
        roomCount: 0,
      });

      logger.info(`Worker ${i} created [pid:${worker.pid}]`);
    }

    logger.info(`All ${numWorkers} workers initialized`);
  }

  // 최소 부하 Worker 선택
  getWorker(): { worker: Worker; workerId: number } {
    const workerInfo = this.workers.reduce((min, current, idx, arr) => {
      return current.roomCount < arr[min].roomCount ? idx : min;
    }, 0);

    const selectedWorker = this.workers[workerInfo];

    logger.info(`Selected worker ${workerInfo} (current rooms: ${selectedWorker.roomCount})`);

    return {
      worker: selectedWorker.worker,
      workerId: workerInfo,
    };
  }

  incrementRoomCount(workerId: number) {
    this.workers[workerId].roomCount++;
    logger.info(`Worker ${workerId} room count: ${this.workers[workerId].roomCount}`);
  }

  decrementRoomCount(workerId: number) {
    this.workers[workerId].roomCount--;
    logger.info(`Worker ${workerId} room count: ${this.workers[workerId].roomCount}`);
  }

  getWorkerStats() {
    return this.workers.map((w, idx) => ({
      workerId: idx,
      pid: w.worker.pid,
      roomCount: w.roomCount,
    }));
  }
}

export const workerPool = new WorkerPool();

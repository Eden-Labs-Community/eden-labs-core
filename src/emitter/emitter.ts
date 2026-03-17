import { createEnvelope, EventEnvelope } from "../envelope/envelope.js";
import { PendingQueue } from "../pending-queue/pending-queue.js";

export interface UdpSocket {
  send(msg: Buffer): void;
}

interface EmitterOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
}

const DEFAULT_RETRY_INTERVAL_MS = 1000;

export class Emitter {
  private readonly queue: PendingQueue;
  private readonly interval: ReturnType<typeof setInterval>;

  constructor(
    private readonly socket: UdpSocket,
    options?: EmitterOptions
  ) {
    this.queue = new PendingQueue(
      options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined
    );

    this.interval = setInterval(
      () => this.retryExpired(),
      options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS
    );
  }

  emit(type: string, payload: unknown, options?: { room?: string }): void {
    const input: Pick<EventEnvelope, "type" | "payload"> = { type, payload };
    const envelope = createEnvelope(
      options?.room !== undefined ? { ...input, room: options.room } : input
    );
    this.queue.add(envelope);
    this.socket.send(Buffer.from(JSON.stringify(envelope)));
  }

  acknowledge(id: string): void {
    this.queue.acknowledge(id);
  }

  getPending(): EventEnvelope[] {
    return this.queue.getPending();
  }

  retryExpired(): void {
    for (const envelope of this.queue.getExpired()) {
      this.socket.send(Buffer.from(JSON.stringify(envelope)));
    }
  }

  stop(): void {
    clearInterval(this.interval);
  }
}

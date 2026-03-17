import { EventEnvelope } from "../envelope/envelope.js";

interface PendingEntry {
  envelope: EventEnvelope;
  sentAt: number;
}

interface PendingQueueOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class PendingQueue {
  private readonly entries = new Map<string, PendingEntry>();
  private readonly timeoutMs: number;

  constructor(options?: PendingQueueOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  add(envelope: EventEnvelope): void {
    this.entries.set(envelope.id, { envelope, sentAt: Date.now() });
  }

  acknowledge(id: string): void {
    this.entries.delete(id);
  }

  getPending(): EventEnvelope[] {
    return [...this.entries.values()].map((e) => e.envelope);
  }

  getExpired(): EventEnvelope[] {
    const now = Date.now();
    return [...this.entries.values()]
      .filter((e) => now - e.sentAt >= this.timeoutMs)
      .map((e) => e.envelope);
  }
}

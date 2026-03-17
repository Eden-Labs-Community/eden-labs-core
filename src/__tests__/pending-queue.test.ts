import { PendingQueue } from "../pending-queue/pending-queue.js";
import { createEnvelope } from "../envelope/envelope.js";

describe("PendingQueue", () => {
  it("adds an envelope to the queue", () => {
    const queue = new PendingQueue();
    const envelope = createEnvelope({ type: "eden:user:created", payload: {} });

    queue.add(envelope);

    expect(queue.getPending()).toHaveLength(1);
  });

  it("removes envelope from queue when acknowledged", () => {
    const queue = new PendingQueue();
    const envelope = createEnvelope({ type: "eden:user:created", payload: {} });

    queue.add(envelope);
    queue.acknowledge(envelope.id);

    expect(queue.getPending()).toHaveLength(0);
  });

  it("returns envelopes that exceeded the timeout", () => {
    const queue = new PendingQueue({ timeoutMs: 0 });
    const envelope = createEnvelope({ type: "eden:user:created", payload: {} });

    queue.add(envelope);

    expect(queue.getExpired()).toHaveLength(1);
  });
});

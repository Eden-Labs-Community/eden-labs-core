import { jest } from "@jest/globals";
import { Emitter } from "../emitter/emitter.js";
import { EdenInvalidEventTypeError } from "../errors/errors.js";

describe("Emitter", () => {
  let emitter: Emitter;

  afterEach(() => emitter.stop());

  it("emits a serialized envelope through the socket", () => {
    const sent: Buffer[] = [];
    const fakeSocket = { send: (msg: Buffer) => sent.push(msg) };

    emitter = new Emitter(fakeSocket);
    emitter.emit("eden:user:created", { id: "1" });

    expect(sent).toHaveLength(1);
    const parsed = JSON.parse(sent[0]!.toString());
    expect(parsed.type).toBe("eden:user:created");
    expect(parsed.id).toBeDefined();
  });

  it("emits an envelope to a specific room", () => {
    const sent: Buffer[] = [];
    const fakeSocket = { send: (msg: Buffer) => sent.push(msg) };

    emitter = new Emitter(fakeSocket);
    emitter.emit("eden:chat:message", { text: "hi" }, { room: "sala-1" });

    const parsed = JSON.parse(sent[0]!.toString());
    expect(parsed.room).toBe("sala-1");
  });

  it("removes envelope from pending queue when ACK is received", () => {
    const sent: Buffer[] = [];
    const fakeSocket = { send: (msg: Buffer) => sent.push(msg) };

    emitter = new Emitter(fakeSocket);
    emitter.emit("eden:user:created", {});

    const id = JSON.parse(sent[0]!.toString()).id;
    emitter.acknowledge(id);

    expect(emitter.getPending()).toHaveLength(0);
  });

  it("resends expired envelopes", () => {
    const sent: Buffer[] = [];
    const fakeSocket = { send: (msg: Buffer) => sent.push(msg) };

    emitter = new Emitter(fakeSocket, { timeoutMs: 0 });
    emitter.emit("eden:user:created", {});
    emitter.retryExpired();

    expect(sent).toHaveLength(2);
  });

  it("automatically retries expired envelopes after interval", () => {
    jest.useFakeTimers();

    const sent: Buffer[] = [];
    const fakeSocket = { send: (msg: Buffer) => sent.push(msg) };

    const emitter = new Emitter(fakeSocket, { timeoutMs: 0, retryIntervalMs: 100 });
    emitter.emit("eden:user:created", {});

    jest.advanceTimersByTime(100);

    expect(sent).toHaveLength(2);

    emitter.stop();
    jest.useRealTimers();
  });

  it("throws EdenInvalidEventTypeError for invalid event type", () => {
    const fakeSocket = { send: () => {} };
    emitter = new Emitter(fakeSocket);

    expect(() => emitter.emit("invalid-type", {}))
      .toThrow(EdenInvalidEventTypeError);
  });
});

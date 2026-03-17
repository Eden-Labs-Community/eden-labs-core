import { Receiver } from "../receiver/receiver.js";
import { createEnvelope } from "../envelope/envelope.js";
import { EdenInvalidEnvelopeError } from "../errors/errors.js";

describe("Receiver", () => {
  it("calls handler with deserialized envelope when a message arrives", () => {
    const received: unknown[] = [];
    const receiver = new Receiver((envelope) => received.push(envelope));

    const envelope = createEnvelope({ type: "eden:user:created", payload: { id: "1" } });
    receiver.handle(Buffer.from(JSON.stringify(envelope)));

    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe("eden:user:created");
  });

  it("sends an ACK after handling the envelope", () => {
    const sent: Buffer[] = [];
    const fakeSocket = { send: (msg: Buffer) => sent.push(msg) };
    const receiver = new Receiver(() => {}, fakeSocket);

    const envelope = createEnvelope({ type: "eden:user:created", payload: {} });
    receiver.handle(Buffer.from(JSON.stringify(envelope)));

    expect(sent).toHaveLength(1);
    const ack = JSON.parse(sent[0]!.toString());
    expect(ack.type).toBe("__ack__");
    expect(ack.id).toBe(envelope.id);
  });

  it("throws EdenInvalidEnvelopeError for malformed JSON", () => {
    const receiver = new Receiver(() => {});
    expect(() => receiver.handle(Buffer.from("not json")))
      .toThrow(EdenInvalidEnvelopeError);
  });

  it("throws EdenInvalidEnvelopeError when envelope is missing id", () => {
    const receiver = new Receiver(() => {});
    const broken = JSON.stringify({ type: "eden:user:created", payload: {} });
    expect(() => receiver.handle(Buffer.from(broken)))
      .toThrow(EdenInvalidEnvelopeError);
  });

  it("throws EdenInvalidEnvelopeError when envelope is missing type", () => {
    const receiver = new Receiver(() => {});
    const broken = JSON.stringify({ id: "123", payload: {} });
    expect(() => receiver.handle(Buffer.from(broken)))
      .toThrow(EdenInvalidEnvelopeError);
  });
});

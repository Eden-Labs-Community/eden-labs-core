import { Bus } from "../bus/bus.js";
import { createEnvelope } from "../envelope/envelope.js";

describe("Bus", () => {
  it("delivers envelope to subscriber", () => {
    const bus = new Bus();
    const received: unknown[] = [];

    bus.subscribe("eden:user:created", (e) => received.push(e));
    bus.publish(createEnvelope({ type: "eden:user:created", payload: {} }));

    expect(received).toHaveLength(1);
  });

  it("does not deliver duplicate envelopes", () => {
    const bus = new Bus();
    const received: unknown[] = [];

    bus.subscribe("eden:user:created", (e) => received.push(e));
    const envelope = createEnvelope({ type: "eden:user:created", payload: {} });
    bus.publish(envelope);
    bus.publish(envelope);

    expect(received).toHaveLength(1);
  });

  it("delivers to room subscriber only when room matches", () => {
    const bus = new Bus();
    const received: unknown[] = [];

    bus.subscribe("eden:msg:sent", (e) => received.push(e), { room: "sala-1" });
    bus.publish(createEnvelope({ type: "eden:msg:sent", payload: {}, room: "sala-2" }));

    expect(received).toHaveLength(0);
  });

  it("broadcasts to all subscribers when envelope has no room", () => {
    const bus = new Bus();
    const received: unknown[] = [];

    bus.subscribe("eden:msg:sent", (e) => received.push(e), { room: "sala-1" });
    bus.subscribe("eden:msg:sent", (e) => received.push(e), { room: "sala-2" });
    bus.publish(createEnvelope({ type: "eden:msg:sent", payload: {} }));

    expect(received).toHaveLength(2);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new Bus();
    const received: unknown[] = [];

    const unsubscribe = bus.subscribe("eden:user:created", (e) => received.push(e));
    unsubscribe();
    bus.publish(createEnvelope({ type: "eden:user:created", payload: {} }));

    expect(received).toHaveLength(0);
  });

  it("does not affect other subscribers when one unsubscribes", () => {
    const bus = new Bus();
    const a: unknown[] = [];
    const b: unknown[] = [];

    const unsubscribe = bus.subscribe("eden:user:created", (e) => a.push(e));
    bus.subscribe("eden:user:created", (e) => b.push(e));

    unsubscribe();
    bus.publish(createEnvelope({ type: "eden:user:created", payload: {} }));

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });
});

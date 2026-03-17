import { Emitter } from "../emitter/emitter.js";
import { Receiver } from "../receiver/receiver.js";
import { Bus } from "../bus/bus.js";
import { UdpSocketImpl } from "../socket/socket.js";
import { EventEnvelope } from "../envelope/envelope.js";

const EMITTER_PORT = 41300;
const RECEIVER_PORT = 41301;

describe("E2E: Emitter → UDP → Receiver → Bus", () => {
  let emitter: Emitter;
  let emitterSocket: UdpSocketImpl;
  let listenSocket: UdpSocketImpl;
  let ackSocket: UdpSocketImpl;

  afterEach(() => {
    emitter.stop();
    emitterSocket.close();
    listenSocket.close();
    ackSocket.close();
  });

  it("delivers an event end-to-end", (done) => {
    const bus = new Bus();

    ackSocket = new UdpSocketImpl({ host: "127.0.0.1", port: EMITTER_PORT });
    const receiver = new Receiver((envelope) => bus.publish(envelope), ackSocket);

    listenSocket = new UdpSocketImpl({ host: "127.0.0.1", port: RECEIVER_PORT });
    listenSocket.bind(RECEIVER_PORT, (msg) => receiver.handle(msg));

    emitterSocket = new UdpSocketImpl({ host: "127.0.0.1", port: RECEIVER_PORT });
    emitter = new Emitter(emitterSocket, { timeoutMs: 5000, retryIntervalMs: 10000 });

    bus.subscribe("eden:user:created", (envelope: EventEnvelope) => {
      expect(envelope.type).toBe("eden:user:created");
      expect((envelope.payload as any).id).toBe("42");
      done();
    });

    emitter.emit("eden:user:created", { id: "42" });
  });

  it("delivers an event to the correct room only", (done) => {
    const bus = new Bus();
    const wrongRoom: unknown[] = [];

    ackSocket = new UdpSocketImpl({ host: "127.0.0.1", port: EMITTER_PORT });
    const receiver = new Receiver((envelope) => bus.publish(envelope), ackSocket);

    listenSocket = new UdpSocketImpl({ host: "127.0.0.1", port: RECEIVER_PORT });
    listenSocket.bind(RECEIVER_PORT, (msg) => receiver.handle(msg));

    emitterSocket = new UdpSocketImpl({ host: "127.0.0.1", port: RECEIVER_PORT });
    emitter = new Emitter(emitterSocket, { timeoutMs: 5000, retryIntervalMs: 10000 });

    bus.subscribe("eden:chat:message", () => wrongRoom.push(true), { room: "sala-2" });
    bus.subscribe("eden:chat:message", (envelope) => {
      expect(wrongRoom).toHaveLength(0);
      expect(envelope.room).toBe("sala-1");
      done();
    }, { room: "sala-1" });

    emitter.emit("eden:chat:message", { text: "hi" }, { room: "sala-1" });
  });
});

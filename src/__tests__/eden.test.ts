import { Eden } from "../eden/eden.js";

const BASE_PORT = 41400;

describe("Eden", () => {
  let eden: Eden;

  afterEach(() => eden.stop());

  it("can be created", () => {
    eden = new Eden({
      listenPort: BASE_PORT,
      remote: { host: "127.0.0.1", port: BASE_PORT + 1 },
    });
    expect(eden).toBeDefined();
  });

  it("receives an event emitted by another Eden instance", (done) => {
    const sender = new Eden({
      listenPort: BASE_PORT + 1,
      remote: { host: "127.0.0.1", port: BASE_PORT + 2 },
    });

    eden = new Eden({
      listenPort: BASE_PORT + 2,
      remote: { host: "127.0.0.1", port: BASE_PORT + 1 },
    });

    eden.on("eden:user:created", (envelope) => {
      expect((envelope.payload as any).id).toBe("1");
      sender.stop();
      done();
    });

    sender.emit("eden:user:created", { id: "1" });
  });

  it("delivers event only to the correct room", (done) => {
    const sender = new Eden({
      listenPort: BASE_PORT + 3,
      remote: { host: "127.0.0.1", port: BASE_PORT + 4 },
    });

    eden = new Eden({
      listenPort: BASE_PORT + 4,
      remote: { host: "127.0.0.1", port: BASE_PORT + 3 },
    });

    const wrongRoom: unknown[] = [];

    eden.on("eden:chat:message", () => wrongRoom.push(true), { room: "sala-2" });
    eden.on("eden:chat:message", (envelope) => {
      expect(wrongRoom).toHaveLength(0);
      expect(envelope.room).toBe("sala-1");
      sender.stop();
      done();
    }, { room: "sala-1" });

    sender.emit("eden:chat:message", { text: "hi" }, { room: "sala-1" });
  });
});

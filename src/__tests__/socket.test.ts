import { UdpSocketImpl } from "../socket/socket.js";

describe("UdpSocketImpl", () => {
  it("sends a message and receives it on the same port", (done) => {
    const socket = new UdpSocketImpl({ host: "127.0.0.1", port: 41234 });

    socket.bind(41234, (msg) => {
      expect(msg.toString()).toBe("hello");
      socket.close();
      done();
    });

    socket.send(Buffer.from("hello"));
  });
});

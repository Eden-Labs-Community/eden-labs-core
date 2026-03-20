import dgram from "node:dgram";
import { MultiUdpTransport } from "../transports/udp/multi-udp-transport.js";
import { EdenTransport } from "../transports/transport.js";

describe("MultiUdpTransport", () => {
  it("implements EdenTransport interface", () => {
    const t: EdenTransport = new MultiUdpTransport();
    expect(t).toBeDefined();
    t.close();
  });

  it("send entrega para todos os peers registrados", (done) => {
    const transport = new MultiUdpTransport();
    const peerA = dgram.createSocket("udp4");
    const peerB = dgram.createSocket("udp4");
    let received = 0;

    const onMessage = (msg: Buffer) => {
      expect(msg.toString()).toBe("hello-multi");
      if (++received === 2) {
        transport.close();
        peerA.close();
        peerB.close();
        done();
      }
    };

    peerA.on("message", onMessage);
    peerB.on("message", onMessage);

    peerA.bind(41401, () => {
      peerB.bind(41402, () => {
        transport.addPeer({ host: "127.0.0.1", port: 41401 });
        transport.addPeer({ host: "127.0.0.1", port: 41402 });
        transport.send(Buffer.from("hello-multi"));
      });
    });
  });

  it("bind recebe mensagens de qualquer endpoint", (done) => {
    const transport = new MultiUdpTransport();
    const sender = dgram.createSocket("udp4");

    transport.bind(41403, (msg) => {
      expect(msg.toString()).toBe("ping");
      transport.close();
      sender.close();
      done();
    });

    sender.bind(41404, () => {
      sender.send(Buffer.from("ping"), 41403, "127.0.0.1");
    });
  });

  it("removePeer para de entregar para o peer removido", (done) => {
    const transport = new MultiUdpTransport();
    const peerA = dgram.createSocket("udp4");
    const peerB = dgram.createSocket("udp4");

    peerB.on("message", () => {
      done(new Error("peerB não deveria receber após removePeer"));
    });

    peerA.on("message", (msg) => {
      expect(msg.toString()).toBe("selective");
      // grace period: garante que peerB não recebe nada no loopback
      setTimeout(() => {
        transport.close();
        peerA.close();
        peerB.close();
        done();
      }, 50);
    });

    peerA.bind(41405, () => {
      peerB.bind(41406, () => {
        transport.addPeer({ host: "127.0.0.1", port: 41405 });
        transport.addPeer({ host: "127.0.0.1", port: 41406 });
        transport.removePeer({ host: "127.0.0.1", port: 41406 });
        transport.send(Buffer.from("selective"));
      });
    });
  });

  it("send não lança quando não há peers registrados", () => {
    const t = new MultiUdpTransport();
    expect(() => t.send(Buffer.from("noop"))).not.toThrow();
    t.close();
  });

  it("close é idempotente — não lança em chamadas múltiplas", () => {
    const t = new MultiUdpTransport();
    expect(() => { t.close(); t.close(); }).not.toThrow();
  });

  it("close limpa a lista de peers — getPeerCount() === 0 após fechar", () => {
    const t = new MultiUdpTransport();
    t.addPeer({ host: "127.0.0.1", port: 41407 });
    t.addPeer({ host: "127.0.0.1", port: 41408 });
    expect(t.getPeerCount()).toBe(2);
    t.close();
    expect(t.getPeerCount()).toBe(0);
  });
});

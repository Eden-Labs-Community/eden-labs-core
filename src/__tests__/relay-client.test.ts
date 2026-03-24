import { WebSocketServer, WebSocket } from "ws";
import { RelayClient } from "../relay/relay-client.js";

// TASK-026: RelayClient uses send/message protocol (no identify)
describe("RelayClient", () => {
  let server: WebSocketServer;
  let port: number;

  // Mock server: routes send→message between peers.
  // Peers register via join or are auto-registered on first send.
  function startRelayServer(): Promise<void> {
    return new Promise((resolve) => {
      server = new WebSocketServer({ port: 0 }, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });

      const wsByPeerId = new Map<string, WebSocket>();

      server.on("connection", (ws: WebSocket) => {
        let myPeerId: string | null = null;

        ws.on("message", (data: Buffer) => {
          const msg = JSON.parse(data.toString());

          if (msg.type === "join") {
            myPeerId = msg.peerId;
            wsByPeerId.set(msg.peerId, ws);
          }

          if (msg.type === "send") {
            const target = wsByPeerId.get(msg.targetPeerId);
            if (target && target.readyState === WebSocket.OPEN) {
              target.send(
                JSON.stringify({ type: "message", fromPeerId: myPeerId, payload: msg.payload })
              );
            }
          }
        });

        ws.on("close", () => {
          if (myPeerId) wsByPeerId.delete(myPeerId);
        });
      });
    });
  }

  beforeEach(() => startRelayServer());
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("send uses { type: 'send', targetPeerId, payload } format", (done) => {
    const captureServer = new WebSocketServer({ port: 0 });
    const capturePort = (captureServer.address() as { port: number }).port;
    let captured: any = null;

    captureServer.on("connection", (ws: WebSocket) => {
      ws.on("message", (data: Buffer) => {
        captured = JSON.parse(data.toString());
      });
    });

    const client = new RelayClient(`ws://127.0.0.1:${capturePort}`, "me", "them");
    client.waitForReady().then(() => {
      client.send(Buffer.from("test payload"));

      setTimeout(() => {
        expect(captured.type).toBe("send");
        expect(captured.targetPeerId).toBe("them");
        expect(captured.payload).toBeDefined();
        expect(captured.fromPeerId).toBeUndefined();
        client.close();
        captureServer.close(() => done());
      }, 50);
    });
  }, 3000);

  it("sends join instead of identify on connect", (done) => {
    const messages: any[] = [];
    const captureServer = new WebSocketServer({ port: 0 });
    const capturePort = (captureServer.address() as { port: number }).port;

    captureServer.on("connection", (ws: WebSocket) => {
      ws.on("message", (data: Buffer) => {
        messages.push(JSON.parse(data.toString()));
      });
    });

    const client = new RelayClient(`ws://127.0.0.1:${capturePort}`, "me", "them");
    client.waitForReady().then(() => {
      client.send(Buffer.from("msg"));
      setTimeout(() => {
        const identifyMsgs = messages.filter((m) => m.type === "identify");
        const joinMsgs = messages.filter((m) => m.type === "join");
        expect(identifyMsgs).toHaveLength(0);
        expect(joinMsgs).toHaveLength(1);
        expect(joinMsgs[0].peerId).toBe("me");
        client.close();
        captureServer.close(() => done());
      }, 50);
    });
  }, 3000);

  it("receives { type: 'message' } from server", (done) => {
    // Custom server that sends a message to the client
    const msgServer = new WebSocketServer({ port: 0 });
    const msgPort = (msgServer.address() as { port: number }).port;

    msgServer.on("connection", (ws: WebSocket) => {
      ws.once("open", () => {});
      // Send a message to the client after a short delay
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: "message",
          fromPeerId: "other",
          payload: Buffer.from("hello").toString("base64"),
        }));
      }, 50);
    });

    const client = new RelayClient(`ws://127.0.0.1:${msgPort}`, "me", "other");
    client.bind(0, (msg) => {
      expect(msg.toString()).toBe("hello");
      client.close();
      msgServer.close(() => done());
    });
  }, 3000);

  it("waitForReady resolves without identify handshake", async () => {
    const noopServer = new WebSocketServer({ port: 0 });
    const noopPort = (noopServer.address() as { port: number }).port;
    noopServer.on("connection", () => {});

    const client = new RelayClient(`ws://127.0.0.1:${noopPort}`, "me", "them");
    await client.waitForReady();

    client.close();
    await new Promise<void>((resolve) => noopServer.close(() => resolve()));
  }, 3000);

  it("close terminates the WebSocket", (done) => {
    const client = new RelayClient(`ws://127.0.0.1:${port}`, "peer-close-test", "other");
    client.bind(0, () => {});

    setTimeout(() => {
      client.close();
      setTimeout(() => {
        expect(server.clients.size).toBe(0);
        done();
      }, 50);
    }, 50);
  }, 3000);

  it("queued messages are sent on connection open", (done) => {
    const captureServer = new WebSocketServer({ port: 0 });
    const capturePort = (captureServer.address() as { port: number }).port;
    const received: any[] = [];

    captureServer.on("connection", (ws: WebSocket) => {
      ws.on("message", (data: Buffer) => {
        received.push(JSON.parse(data.toString()));
      });
    });

    const client = new RelayClient(`ws://127.0.0.1:${capturePort}`, "me", "them");
    // Send before connection is open — should queue
    client.send(Buffer.from("queued-msg"));

    setTimeout(() => {
      const sendMsgs = received.filter((m) => m.type === "send");
      expect(sendMsgs).toHaveLength(1);
      expect(sendMsgs[0].targetPeerId).toBe("them");
      client.close();
      captureServer.close(() => done());
    }, 200);
  }, 3000);
});

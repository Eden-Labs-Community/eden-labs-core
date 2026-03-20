import { WebSocket } from "ws";
import { Endpoint } from "../transports/transport.js";
import { EdenSignalingError } from "../errors/errors.js";

type ServerMessage =
  | { type: "registered" }
  | { type: "peer_endpoint"; endpoint: Endpoint }
  | { type: "error"; reason: string };

interface SignalingClientOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private readonly timeoutMs: number;

  constructor(
    private readonly url: string,
    options: SignalingClientOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async register(peerId: string, endpoint: Endpoint): Promise<void> {
    const ws = await this.connect();
    await this.send(ws, { type: "register", peerId, endpoint }, "registered");
  }

  async requestConnect(myId: string, targetId: string): Promise<Endpoint> {
    const ws = await this.connect();
    const msg = await this.send(ws, { type: "request_connect", myId, targetId }, "peer_endpoint");
    return (msg as { type: "peer_endpoint"; endpoint: Endpoint }).endpoint;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }

    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new EdenSignalingError("connection timeout"));
      }, this.timeoutMs);

      ws.once("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve(ws);
      });

      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(new EdenSignalingError(err.message));
      });
    });
  }

  private send(
    ws: WebSocket,
    payload: object,
    expectedType: string
  ): Promise<ServerMessage> {
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off("message", onMessage);
        reject(new EdenSignalingError(`timeout waiting for "${expectedType}"`));
      }, this.timeoutMs);

      const onMessage = (data: Buffer) => {
        const msg: ServerMessage = JSON.parse(data.toString());

        if (msg.type === "error") {
          clearTimeout(timer);
          ws.off("message", onMessage);
          reject(new EdenSignalingError(msg.reason));
          return;
        }

        if (msg.type === expectedType) {
          clearTimeout(timer);
          ws.off("message", onMessage);
          resolve(msg);
        }
      };

      ws.on("message", onMessage);
      ws.send(JSON.stringify(payload));
    });
  }
}

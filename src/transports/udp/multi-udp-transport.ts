import dgram from "node:dgram";
import { EdenTransport, Endpoint } from "../transport.js";

function key(endpoint: Endpoint): string {
  return `${endpoint.host}:${endpoint.port}`;
}

export class MultiUdpTransport implements EdenTransport {
  private socket: dgram.Socket | null = dgram.createSocket("udp4");
  private peers: Map<string, Endpoint> = new Map();

  addPeer(endpoint: Endpoint): void {
    this.peers.set(key(endpoint), endpoint);
  }

  removePeer(endpoint: Endpoint): void {
    this.peers.delete(key(endpoint));
  }

  send(msg: Buffer): void {
    if (!this.socket) return;
    for (const peer of this.peers.values()) {
      this.socket.send(msg, peer.port, peer.host);
    }
  }

  bind(port: number, onMessage: (msg: Buffer) => void): void {
    if (!this.socket) return;
    this.socket.bind(port);
    this.socket.on("message", onMessage);
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  close(): void {
    this.peers.clear();
    try { this.socket?.close(); } catch { /* already closed */ }
    this.socket = null;
  }
}

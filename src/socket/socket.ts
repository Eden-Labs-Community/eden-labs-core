import dgram from "node:dgram";
import { UdpSocket } from "../emitter/emitter.js";

interface UdpSocketOptions {
  host: string;
  port: number;
}

export class UdpSocketImpl implements UdpSocket {
  private readonly socket: dgram.Socket;

  constructor(private readonly options: UdpSocketOptions) {
    this.socket = dgram.createSocket("udp4");
  }

  send(msg: Buffer): void {
    this.socket.send(msg, this.options.port, this.options.host);
  }

  bind(port: number, onMessage: (msg: Buffer) => void): void {
    this.socket.bind(port);
    this.socket.on("message", onMessage);
  }

  close(): void {
    this.socket.close();
  }
}

import { Emitter } from "../emitter/emitter.js";
import { Receiver } from "../receiver/receiver.js";
import { Bus } from "../bus/bus.js";
import { UdpSocketImpl } from "../socket/socket.js";
import { EventEnvelope } from "../envelope/envelope.js";

interface RemoteAddress {
  host: string;
  port: number;
}

interface EdenOptions {
  listenPort: number;
  remote: RemoteAddress;
  timeoutMs?: number;
  retryIntervalMs?: number;
}

type Handler = (envelope: EventEnvelope) => void;
type Unsubscribe = () => void;

export class Eden {
  private readonly bus: Bus;
  private readonly emitter: Emitter;
  private readonly listenSocket: UdpSocketImpl;
  private readonly emitSocket: UdpSocketImpl;
  private readonly ackSocket: UdpSocketImpl;

  constructor(options: EdenOptions) {
    this.bus = new Bus();

    this.ackSocket = new UdpSocketImpl({ host: options.remote.host, port: options.remote.port });
    const receiver = new Receiver((envelope) => this.bus.publish(envelope), this.ackSocket);

    this.listenSocket = new UdpSocketImpl({ host: "127.0.0.1", port: options.listenPort });
    this.listenSocket.bind(options.listenPort, (msg) => receiver.handle(msg));

    this.emitSocket = new UdpSocketImpl({ host: options.remote.host, port: options.remote.port });

    const emitterOptions = {
      ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      ...(options.retryIntervalMs !== undefined && { retryIntervalMs: options.retryIntervalMs }),
    };
    this.emitter = new Emitter(this.emitSocket, emitterOptions);
  }

  on(type: string, handler: Handler, options?: { room?: string }): Unsubscribe {
    return this.bus.subscribe(type, handler, options);
  }

  emit(type: string, payload: unknown, options?: { room?: string }): void {
    this.emitter.emit(type, payload, options);
  }

  stop(): void {
    this.emitter.stop();
    this.listenSocket.close();
    this.emitSocket.close();
    this.ackSocket.close();
  }
}

import { EventEnvelope } from "../envelope/envelope.js";
import { Deduplicator } from "../deduplicator/deduplicator.js";

type Handler = (envelope: EventEnvelope) => void;
type Unsubscribe = () => void;

interface SubscribeOptions {
  room?: string;
}

interface Subscription {
  handler: Handler;
  room?: string;
}

export class Bus {
  private readonly subscriptions = new Map<string, Subscription[]>();
  private readonly deduplicator = new Deduplicator();

  subscribe(type: string, handler: Handler, options?: SubscribeOptions): Unsubscribe {
    const subs = this.subscriptions.get(type) ?? [];
    const sub: Subscription = { handler };
    if (options?.room !== undefined) sub.room = options.room;
    subs.push(sub);
    this.subscriptions.set(type, subs);

    return () => {
      const current = this.subscriptions.get(type) ?? [];
      this.subscriptions.set(type, current.filter((s) => s !== sub));
    };
  }

  publish(envelope: EventEnvelope): void {
    if (this.deduplicator.seen(envelope.id)) return;

    const subs = this.subscriptions.get(envelope.type) ?? [];

    for (const sub of subs) {
      const roomMatches = envelope.room === undefined || sub.room === undefined || sub.room === envelope.room;
      if (roomMatches) sub.handler(envelope);
    }
  }
}

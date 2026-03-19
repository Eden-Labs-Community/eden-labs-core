# @eden_labs/root

Event manager for the Eden ecosystem. Fast, reliable event bus over raw UDP with at-least-once delivery guarantees.

## How it works

```
Eden A                        Eden B
  |                             |
  | emit("eden:user:created")   |
  |──────── UDP ───────────────>|
  |                             | on("eden:user:created", handler)
  |<──────── ACK ───────────────|
```

Events are sent as UDP packets. The emitter retries automatically if no ACK arrives. The receiver deduplicates repeated deliveries — your handler is never called twice for the same event.

---

## Quick start

```ts
import { Eden } from "@eden_labs/core";

const a = new Eden({
  listenPort: 5000,
  remote: { host: "127.0.0.1", port: 5001 },
});

const b = new Eden({
  listenPort: 5001,
  remote: { host: "127.0.0.1", port: 5000 },
});

b.on("eden:user:created", (envelope) => {
  console.log(envelope.payload); // { id: "123" }
});

b.on("eden:chat:message", (envelope) => {
  console.log(envelope.payload);
}, { room: "sala-1" });

a.emit("eden:user:created", { id: "123" });
a.emit("eden:chat:message", { text: "hi" }, { room: "sala-1" });

a.stop();
b.stop();
```

---

## API

### `new Eden(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `listenPort` | `number` | required | Local UDP port to listen on |
| `remote.host` | `string` | required | Remote host to send events to |
| `remote.port` | `number` | required | Remote port to send events to |
| `timeoutMs` | `number` | `5000` | Time before retrying an unacknowledged event |
| `retryIntervalMs` | `number` | `1000` | How often to check for expired events |

### `eden.on(type, handler, options?)`

Registers a listener for an event type. Returns an `unsubscribe` function.

```ts
const unsubscribe = eden.on("eden:user:created", (envelope) => {
  console.log(envelope.type, envelope.payload);
});

// stop listening
unsubscribe();
```

Options:
- `room?: string` — only receive events sent to this room

### `eden.emit(type, payload, options?)`

Emits an event to the remote instance.

```ts
eden.emit("eden:user:created", { id: "1" });
eden.emit("eden:chat:message", { text: "hi" }, { room: "sala-1" });
```

Options:
- `room?: string` — send to a specific room

### `eden.stop()`

Closes all sockets and stops the retry interval. Must be called when the instance is no longer needed.

```ts
process.on("SIGTERM", () => {
  eden.stop();
  process.exit(0);
});
```

---

## Event types

Must follow the format `{namespace}:{domain}:{action}`:

```
eden:user:created      ✓
eden:order:updated     ✓
eden:chat:message      ✓

user:created           ✗  (missing namespace)
created                ✗  (only one part)
```

Throws `EdenInvalidEventTypeError` if the format is invalid.

---

## Envelope

Every event is wrapped in an envelope automatically:

```ts
{
  id: string;        // UUID v4 — used for deduplication
  type: string;      // "eden:user:created"
  payload: unknown;  // your event data
  timestamp: number; // Unix ms
  version: string;   // protocol version
  room?: string;     // present if emitted to a room
}
```

---

## Delivery guarantees

| What | How |
|------|-----|
| At-least-once | Emitter retries until ACK received |
| No duplicates | Receiver deduplicates by envelope `id` |
| Effectively exactly-once | Both combined |

---

## Rooms

- **No room** → delivered to all listeners of that event type (broadcast)
- **With room** → delivered only to listeners subscribed to that room

```ts
// only receives events emitted to "sala-1"
eden.on("eden:chat:message", handler, { room: "sala-1" });

// receives all "eden:chat:message" events regardless of room
eden.on("eden:chat:message", handler);
```

---

## Errors

All errors extend `EdenError`:

| Error | When |
|-------|------|
| `EdenInvalidEventTypeError` | Event type doesn't follow `{ns}:{domain}:{action}` format |
| `EdenInvalidEnvelopeError` | Received message is not valid JSON or missing required fields |

```ts
import { EdenError, EdenInvalidEventTypeError } from "@eden_labs/core";

try {
  eden.emit("bad-type", {});
} catch (err) {
  if (err instanceof EdenInvalidEventTypeError) {
    console.error(err.message);
  }
}
```

---

## Development

```bash
npm test            # run all tests
npm run test:watch  # watch mode
npm run build       # compile to dist/
```

All code follows strict TDD — no production code without a failing test first.

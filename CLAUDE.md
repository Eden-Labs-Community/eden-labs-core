# eden-core — Decisões de Arquitetura

## Propósito
Gerenciador de eventos do ecossistema Eden. Módulo público importável por qualquer projeto do ecossistema. Implementa transporte via **UDP puro** (`node:dgram`), define o protocolo de envelope e gerencia rooms, ACK e deduplicação.

A API pública principal é a classe `Eden` — encapsula toda a complexidade interna e expõe apenas `.on()` e `.emit()`.

---

## Protocolo de Eventos

### Envelope — mensagem de evento
```ts
{
  id: string;        // UUID v4 — chave de deduplicação
  type: string;      // namespaced: "eden:{domain}:{action}"
  payload: unknown;  // tipado pelo evento concreto
  timestamp: number; // Unix ms
  version: string;   // semver do protocolo, ex: "1.0.0"
  room?: string;     // opcional — ausente = broadcast global
}
```

### Envelope — ACK
```ts
{
  type: "__ack__";
  id: string;        // ID da mensagem original
  receivedAt: number;
}
```

### Namespacing de eventos
Formato: `{namespace}:{domain}:{action}`
Exemplo: `eden:user:created`, `eden:order:updated`

### Broadcast
- `room` ausente → entregue a todos os subscribers daquele tipo
- `room` presente → entregue apenas aos subscribers daquela room

---

## Módulos e Responsabilidades

### `eden/eden.ts` ← ponto de entrada principal
Encapsula `Emitter`, `Receiver`, `Bus` e todos os sockets. É a API pública do ecossistema.
- `on(type, handler, { room? })` → `Unsubscribe` — registra listener
- `emit(type, payload, { room? })` — emite evento
- `stop()` — encerra todos os recursos (sockets + interval)

### `errors/errors.ts`
Classes de erro do ecossistema Eden.
- `EdenError` — base de todos os erros
- `EdenInvalidEventTypeError` — tipo fora do formato `{ns}:{domain}:{action}`
- `EdenInvalidEnvelopeError` — envelope malformado ou com campos obrigatórios ausentes

### `envelope/envelope.ts`
Fábrica e tipo do `EventEnvelope`. Valida o formato do tipo antes de criar.
- `createEnvelope({ type, payload, room? })` → `EventEnvelope`
- Lança `EdenInvalidEventTypeError` se o tipo não seguir o formato

### `emitter/emitter.ts`
Serializa e envia envelopes via socket. Gerencia `PendingQueue` e retry automático.
- `emit(type, payload, { room? })` — emite e adiciona à fila pendente
- `acknowledge(id)` — remove da fila ao receber ACK
- `retryExpired()` — reenvia expirados (chamado automaticamente via setInterval)
- `stop()` — limpa o interval
- Opções: `timeoutMs` (padrão 5000ms), `retryIntervalMs` (padrão 1000ms)

### `receiver/receiver.ts`
Desserializa o `Buffer` UDP, valida o envelope e chama o handler. Envia ACK automaticamente.
- `handle(msg: Buffer)` — entry point para mensagens UDP recebidas
- Lança `EdenInvalidEnvelopeError` se o JSON for inválido ou campos obrigatórios ausentes
- Envia ACK com `{ type: "__ack__", id, receivedAt }` após processar

### `bus/bus.ts`
Roteador pub/sub interno. Usado pelo `Eden` para distribuir eventos aos listeners.
- `subscribe(type, handler, { room? })` → `Unsubscribe`
- `publish(envelope)` — roteia para subscribers corretos, descartando duplicatas

### `deduplicator/deduplicator.ts`
Mantém seen set de IDs processados. Usado pelo `Bus`.
- `seen(id)` → `boolean`

### `pending-queue/pending-queue.ts`
Fila de envelopes aguardando ACK. Usado pelo `Emitter`.
- `add(envelope)`, `acknowledge(id)`, `getPending()`, `getExpired()`

### `socket/socket.ts`
Única camada que conhece `node:dgram`.
- `send(msg: Buffer)`, `bind(port, onMessage)`, `close()`

---

## Fluxo completo

```
Eden.emit()
  → Emitter.emit()
      → createEnvelope() — valida type, gera UUID
      → PendingQueue.add()
      → UdpSocket.send() — pacote UDP

Eden (receptor)
  → UdpSocket.bind() — escuta porta
  → Receiver.handle()
      → valida JSON e campos obrigatórios
      → Bus.publish()
          → Deduplicator.seen() — descarta duplicata
          → roteia por type + room
          → chama handlers registrados via .on()
      → envia ACK via socket

Emitter (retry automático a cada retryIntervalMs)
  → PendingQueue.getExpired()
  → reenvia via socket
  → Receiver descarta pelo Deduplicator
```

---

## Estrutura de arquivos

```
src/
  __tests__/
  eden/eden.ts             ← API pública principal
  errors/errors.ts
  envelope/envelope.ts
  emitter/emitter.ts
  receiver/receiver.ts
  bus/bus.ts
  deduplicator/deduplicator.ts
  pending-queue/pending-queue.ts
  socket/socket.ts
  index.ts                 ← public exports (a fazer)
```

---

## Transporte — UDP (`node:dgram`)
- Zero dependências externas
- `socket/socket.ts` é o único arquivo que conhece `dgram`
- A interface `UdpSocket` permite outros transportes sem mudar `Emitter` ou `Receiver`
- Serialização: JSON (binário/MessagePack pode ser adotado depois sem mudar contratos)

---

## TDD — Regras
- Nenhuma linha de produção sem teste falhando antes
- Ciclo: Red → Green → Refactor
- Testes unitários: fake socket (array de Buffers), sem I/O real
- Testes de integração: socket UDP real (loopback 127.0.0.1)

---

## Distribuição
- `@eden-labs/core` — NPM público, ESM, TypeScript com exports de tipos
- SDKs para outras linguagens = repos separados implementando o mesmo protocolo de envelope

---

## Decisões Fechadas
- [x] UDP puro via `node:dgram` — sem Socket.IO, sem WebSocket
- [x] `Eden` como API principal — encapsula toda complexidade interna
- [x] Broadcast global (room ausente) + rooms opcionais
- [x] At-least-once + idempotent consumer (deduplicação por UUID)
- [x] Retry automático no Emitter via setInterval
- [x] ACK automático no Receiver
- [x] Erros tipados com hierarquia `EdenError`
- [x] Interface `UdpSocket` permite outros transportes sem mudar Emitter/Receiver
- [x] Multi-linguagem via repos separados

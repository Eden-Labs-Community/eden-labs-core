# eden-core — Decisões de Arquitetura

## Propósito
Gerenciador de eventos do ecossistema Eden. Módulo público (`@eden_labs/tree`) importável por qualquer projeto do ecossistema. Implementa um event bus com at-least-once delivery sobre UDP puro (`node:dgram`) com suporte a NAT traversal, broadcast mesh multi-hop, criptografia end-to-end e roteamento inteligente (server vs mesh).

A API pública principal é a classe `Eden` — encapsula toda a complexidade interna e expõe apenas `.on()`, `.emit()` e `.stop()`.

---

## Protocolo de Eventos

### Envelope — mensagem de evento
```ts
{
  id: string;        // UUID v4 — chave de deduplicação (mata loops na mesh)
  type: string;      // namespaced: "{ns}:{domain}:{action}"
  payload: unknown;  // tipado pelo evento concreto
  timestamp: number; // Unix ms
  version: string;   // semver do protocolo, ex: "1.0.0"
  room?: string;     // opcional — ausente = broadcast global
  ttl?: number;      // opcional — hops restantes na mesh (default 10, decrementa a cada hop)
  origin?: string;   // opcional — peerId do emissor original
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

**IMPORTANTE:** ACKs são interceptados em `eden.ts` ANTES do `Bus.publish()` e roteados para `emitter.acknowledge(id)`. O `Receiver` NÃO envia ACK para mensagens que já são ACKs (evita cascata infinita). ACKs NÃO são propagados pela mesh.

### Namespacing de eventos
Formato: `{namespace}:{domain}:{action}` — obrigatório 3 segmentos separados por `:`
Exemplo: `eden:user:created`, `eden:order:updated`, `eden:chat:message`

### Broadcast e Rooms
- `room` ausente → entregue a todos os subscribers daquele tipo
- `room` presente → entregue apenas aos subscribers daquela room
- Rooms são gerenciadas pelos peers (RoomManager), não pelo server

---

## Protocolo de Sinalização (WebSocket)

### Troca de endpoints (hole punch)
```
cliente → server:  { type: "register", peerId, endpoint, publicKey? }
server → cliente:  { type: "registered" }
cliente → server:  { type: "request_connect", myId, targetId }
server → cliente:  { type: "peer_endpoint", endpoint, publicKey? }
              ou:  { type: "error", reason: "peer_not_found" }
```

### Send direto (relay/1:1)
```
cliente → server:  { type: "join", peerId }       ← associa WS ao peerId
cliente → server:  { type: "send", targetPeerId, payload }
server → target:   { type: "message", fromPeerId, payload }
```

**Nota:** `identify` foi removido — WS é associado ao peerId no `join`. `relay`/`data` foram substituídos por `send`/`message` unificados.

---

## Camadas da Arquitetura

```
Aplicação
  ↕
Eden (API: on/emit/stop)
  ↕
MessageRouter (decide server vs mesh)
  ↕                    ↕
Server (send 1:1)    MeshRelay (flooding multi-hop)
                       ↕
                     MultiP2PTransport (peers diretos, NAT traversal)
                       ↕
                     UDP / Relay WebSocket
```

### Dois caminhos de entrega
1. **Server up + mensagem 1:1** → send direto pelo server (rápido, 1 hop)
2. **Server down ou broadcast** → mesh flooding via transport (resiliente, multi-hop)

O `MessageRouter` decide automaticamente. Se server.send falha, cai pra mesh. Broadcast sempre usa mesh.

### Rooms
- Peer mantém membership local (`RoomManager`)
- Join/leave anuncia pros membros via router.send (1:1 se server up, mesh se down)
- Mensagem pra room pequena → N sends 1:1 via server
- Mensagem pra room grande (>broadcastThreshold) ou broadcast → mesh flooding
- **Server não sabe de rooms** — toda lógica no peer

---

## Módulos e Responsabilidades

### `eden/eden.ts` ← ponto de entrada principal
Encapsula `Emitter`, `Receiver`, `Bus` e 3 sockets (ackSocket, listenSocket, emitSocket). É a API pública do ecossistema.
- `on(type, handler, { room? })` → `Unsubscribe` — registra listener
- `emit(type, payload, { room? })` — emite evento
- `stop()` — encerra todos os recursos (sockets + interval)
- `getPendingCount()` — retorna tamanho da fila de pendentes (útil em testes)

**Design:** cria 3 instâncias de transport via factory. Se a factory retorna a MESMA instância (ex: P2PTransport), `stop()` chamará `close()` 3× — todos os transports devem ser idempotentes em `close()`.

**ACK routing:** ao receber uma mensagem com `type === "__ack__"`, o handler em eden.ts chama `emitter.acknowledge(id)` e retorna antes do `bus.publish()`. Isso garante que a `PendingQueue` esvazie após confirmação de entrega.

### `errors/errors.ts`
Classes de erro do ecossistema Eden.
- `EdenError` — base de todos os erros
- `EdenInvalidEventTypeError` — tipo fora do formato `{ns}:{domain}:{action}`
- `EdenInvalidEnvelopeError` — envelope malformado ou com campos obrigatórios ausentes
- `EdenStunTimeoutError` — nenhum servidor STUN respondeu no prazo
- `EdenSignalingError` — servidor de sinalização retornou erro ou timeout
- `EdenSentinelError` — erro de conexão/operação do sentinel

### `crypto/box.ts`
Primitivas de criptografia stateless com NaCl box (Curve25519 + XSalsa20 + Poly1305).
- `encrypt(plaintext, theirPublicKey, mySecretKey)` → `Uint8Array` com `[ nonce (24 bytes) | ciphertext ]`
- `decrypt(box, theirPublicKey, mySecretKey)` → `Uint8Array | null`
- Nonce aleatório a cada chamada (não determinístico)
- Retorna `null` para chave errada, buffer corrompido ou buffer < 24 bytes
- **Dependência:** `tweetnacl`
- **Performance:** ~2,000 ops/s para encrypt e decrypt (64B–4KB), ~0.5ms/op

### `crypto/identity.ts`
Geração e persistência de par de chaves + derivação determinística de peerId.
- `createIdentity({ path? })` → `Promise<Identity>` — gera ou carrega `{ publicKey, secretKey }`
- Default path: `~/.eden/identity.json` — diretório com `0o700`, arquivo com `0o600`
- Chaves salvas como hex no JSON; segunda chamada retorna as mesmas chaves (persistência)
- `derivePeerId(publicKey)` → SHA-256 hex string (64 chars) — determinístico

### `mesh/mesh-relay.ts`
Camada de flooding multi-hop entre Eden e transport. Opt-in.
- `MeshRelay({ transport, peerId, maxTtl?, onMessage })` — instancia relay
- `bind()` — registra handler no transport
- `emit(msg)` — adiciona `ttl: maxTtl` e `origin: peerId` se ausentes, marca como visto, envia via transport
- Recebimento: deduplica por `id` → descarta se `ttl <= 0` → entrega ao app → forward com `ttl - 1`
- ACKs (`__ack__`) passam para o app mas NÃO são propagados pela mesh
- Non-JSON (probes, heartbeats) passam como-is sem forwarding
- Usa `Deduplicator` próprio (instância separada do Bus)
- **Performance:** ~554k msg/s (overhead de ~138% vs direct por causa de JSON parse/stringify + dedup; negligenciável em rede real vs latência de rede)

### `routing/message-router.ts`
Decisão de roteamento: server vs mesh.
- `MessageRouter({ server, mesh })` — instancia router
- `send(targetPeerId, payload)` — server.isConnected()? → server.send(); se falhar ou offline → mesh.emit()
- `broadcast(payload)` — sempre via mesh
- Transição transparente — aplicação não precisa saber qual caminho foi usado

### `routing/room-manager.ts`
Gerenciamento de membership de rooms no peer. Server não sabe de rooms.
- `join(roomId)` — entra na room, anuncia pros membros existentes via router.send
- `leave(roomId)` — sai da room, anuncia saída pros membros restantes
- `addMember(roomId, peerId)` / `removeMember(roomId, peerId)` — tracking de membros remotos
- `sendToRoom(roomId, payload)` — poucos membros → N sends 1:1; muitos (≥broadcastThreshold) → broadcast
- `getRooms()` / `getMembers(roomId)` — consulta estado local
- `maxPeersPerRoom` (default 100), `broadcastThreshold` (default 50)
- Anúncios de join/leave: `{ type: "__room_join__", roomId, peerId }` / `{ type: "__room_leave__", ... }`

### `envelope/envelope.ts`
Fábrica e tipo do `EventEnvelope`. Valida o formato do tipo antes de criar.
- `createEnvelope({ type, payload, room?, ttl?, origin? })` → `EventEnvelope`
- Lança `EdenInvalidEventTypeError` se o tipo não seguir o formato
- `ttl` e `origin` são opcionais — backward compatible com envelopes antigos

### `emitter/emitter.ts`
Serializa e envia envelopes via socket. Gerencia `PendingQueue` e retry automático.
- `emit(type, payload, { room? })` — emite e adiciona à fila pendente
- `acknowledge(id)` — remove da fila ao receber ACK (chamado via eden.ts, não pelo Bus)
- `retryExpired()` — reenvia expirados (chamado automaticamente via setInterval)
- `stop()` — limpa o interval
- Opções: `timeoutMs` (padrão 5000ms), `retryIntervalMs` (padrão 1000ms)

### `receiver/receiver.ts`
Desserializa o `Buffer`, valida o envelope e chama o handler. Envia ACK automaticamente.
- `handle(msg: Buffer)` — entry point para mensagens recebidas
- Lança `EdenInvalidEnvelopeError` se o JSON for inválido ou campos obrigatórios ausentes
- Envia ACK com `{ type: "__ack__", id, receivedAt }` após processar
- **NÃO envia ACK para mensagens com `type === "__ack__"`** — evita cascata infinita

### `bus/bus.ts`
Roteador pub/sub interno. Usado pelo `Eden` para distribuir eventos aos listeners.
- `subscribe(type, handler, { room? })` → `Unsubscribe`
- `publish(envelope)` — roteia para subscribers corretos, descartando duplicatas via Deduplicator

### `deduplicator/deduplicator.ts`
Mantém seen set de IDs processados. Usado pelo `Bus` e pelo `MeshRelay` (instâncias separadas).
- `seen(id)` → `boolean` — retorna true e marca como visto na primeira chamada

### `pending-queue/pending-queue.ts`
Fila de envelopes aguardando ACK. Usado pelo `Emitter`.
- `add(envelope)`, `acknowledge(id)`, `getPending()`, `getExpired()`

### `transports/transport.ts` ← interface de transporte
```ts
interface Endpoint { host: string; port: number; }
interface EdenTransport {
  send(msg: Buffer): void;
  bind(port: number, onMessage: (msg: Buffer) => void): void;
  close(): void;  // deve ser idempotente — pode ser chamado múltiplas vezes
}
```

### `transports/udp/udp-transport.ts`
Implementação padrão de `EdenTransport` sobre `node:dgram` UDP puro.
- Zero dependências externas
- `close()` idempotente via try/catch (dgram lança se já fechado)

### `transports/udp/multi-udp-transport.ts`
Implementação de `EdenTransport` com socket único para N peers simultâneos.
- `addPeer(endpoint)` / `removePeer(endpoint)` — gerencia peers via Map keyed por `host:port`
- `send(msg)` — fanout para todos os peers registrados
- `bind(port, onMessage)` — escuta qualquer origem no socket único
- `getPeerCount()` — retorna número de peers ativos (usado em testes)
- `close()` — chama `peers.clear()` antes de fechar o socket; idempotente
- **Overhead vs N UdpTransport**: negligenciável (<2%) em fanout, com vantagem de 1 fd vs N

### `transports/p2p/multi-p2p-transport.ts`
Implementação de `EdenTransport` com socket único e NAT traversal por peer.
- `addPeer(myId, targetId, signalingUrl, publicKey?)` — executa STUN→Signaling→HolePunch→Relay para cada peer; armazena publicKey do peer remoto
- `removePeer(peerId)` — remove peer + publicKey, fecha relay, notifica election; se `peers.size === 0` → para election (mesh morta)
- `getPeerCount()` — retorna número de peers ativos
- `getPublicKey(peerId)` → `string | null` — retorna publicKey de um peer conectado
- `send(msg)` — fanout para todos peers (direct via UDP ou relay via WS)
- `bind(port, onMessage)` — cria socket único, filtra `PROBE_MAGIC`, `STUN_MAGIC_COOKIE` e `SENTINEL_HEARTBEAT_MAGIC`; heartbeats roteados para `election.handleHeartbeat()`
- `close()` — para election + sentinel + fecha relays + socket; idempotente
- `getElection()` / `getSentinel()` — retorna instâncias ou null
- `maxPeers` (default 10) — `addPeer()` lança erro acima do limite; reconnects ao mesmo peer bypassam o limite
- Usa `StunClient` com `keepAlive: true, prebound: true` para não destruir socket compartilhado
- Opções de eleição: `heartbeatIntervalMs`, `heartbeatTimeoutMs`, `cascadeStepMs`
- Com `sentinel: true`: primeiro `addPeer()` cria `SentinelElection` + `SignalingSentinel` e inicia como sentinel; promoção/demoção gerenciada automaticamente via election callbacks

### `transports/p2p/p2p-transport.ts`
Implementação de `EdenTransport` com NAT traversal automático (peer único).
- `connect(targetPeerId)` — executa STUN → Signaling → HolePunch → Relay em sequência
- `stunServers: []` → pula STUN (usa loopback/IP local)
- `punchTimeoutMs: 0` → pula hole punch, vai direto para relay
- Filtra `PROBE_MAGIC` do HolePuncher antes de entregar mensagens à aplicação
- `close()` idempotente — anula socket e relay após fechar

### `stun/stun-message.ts`
Implementação RFC 5389 do zero, sem bibliotecas externas.
- `buildBindingRequest()` → Buffer de 20 bytes + magic cookie `0x2112A442`
- `parseBindingResponse(buf)` → decodifica `XOR-MAPPED-ADDRESS` (port XOR magic >> 16, IP XOR magic)

### `stun/stun-client.ts`
Descobre endpoint público enviando Binding Request para múltiplos servidores STUN em paralelo.
- Usa o primeiro que responder
- Lança `EdenStunTimeoutError` se nenhum responder no prazo

### `signaling/signaling-client.ts`
Troca de endpoints entre peers via servidor de sinalização (WebSocket).
- `register(peerId, endpoint, publicKey?)` — registra no servidor com publicKey opcional
- `requestConnect(myId, targetId)` → `ConnectResult { endpoint, publicKey? }` — obtém endpoint + publicKey do peer
- Retry automático (5×, 200ms entre tentativas) — peer remoto pode ainda não ter registrado
- Lança `EdenSignalingError` se peer não encontrado após retries
- Listener de mensagem removido no timeout do `requestConnect` — sem `MaxListenersExceededWarning`

### `hole-punch/hole-puncher.ts`
Envia probes UDP simultâneos para abrir caminho no NAT dos dois lados.
- `punch(remoteEndpoint)` → `Promise<boolean>`
- Retorna `true` quando recebe probe do outro lado
- Grace period de 300ms após receber o primeiro probe (garante simetria de NAT)
- Retorna `false` em timeout — caller decide usar relay

### `relay/relay-client.ts`
Proxy transparente via servidor de sinalização para casos de NAT simétrico estrito.
- Implementa `EdenTransport`
- Envia `{ type: "join", peerId }` ao conectar — associa WS ao peerId no server
- Encapsula mensagens em base64 e envia via `{ type: "send", targetPeerId, payload }`
- Recebe `{ type: "message", fromPeerId, payload }` do server
- `send()` faz queue se WebSocket ainda não está aberto, envia ao abrir
- `waitForReady()` resolve quando WS abre (sem handshake identify)
- `close()` usa `ws.terminate()` + silencia eventos de erro tardios

### `signaling/signaling-sentinel.ts`
Conexão persistente com signaling server via WebSocket. Mantém registro ativo do peer.
- `start()` — conecta e registra no signaling server
- `stop()` — idempotente; fecha WS e limpa timers; adiciona error handler no-op antes de `terminate()` para evitar unhandled errors assíncronos
- `isConnected()` — `true` se WS está OPEN
- `updateEndpoint(ep)` — re-registra com novo endpoint
- Reconexão automática com exponential backoff (`initialBackoffMs`, `maxBackoffMs`, `backoffMultiplier`)
- Callbacks: `onReconnect`, `onDisconnect`
- **IMPORTANTE:** ao fechar WS, sempre chamar `removeAllListeners()` seguido de `.on("error", () => {})` ANTES de `terminate()` — `ws` emite error assíncrono e sem handler causa crash

### `sentinel/sentinel-election.ts`
Eleição de sentinela peer-to-peer via heartbeat + sucessão em cascata.
- `SENTINEL_HEARTBEAT_MAGIC = "__EDEN_SENTINEL_HB__\n"` — prefixo mágico para filtragem barata em `bind()`
- `startAsSentinel()` — epoch=1, começa heartbeat imediato + periódico
- `startAsFollower()` — espera heartbeats, promove após timeout
- `handleHeartbeat(msg)` — parse + lógica de split-brain + reset de timeout
- `peerAdded(peerId)` / `peerRemoved(peerId)` — successors atualizados via `getSuccessors()` callback
- `stop()` — idempotente, limpa todos os timers
- `isSentinelActive()` / `getEpoch()`

**Heartbeat payload:** `{ sentinelId, epoch, successors, ts }` — epoch é monotônico, successors vem da ordem de inserção do Map de peers

**Sucessão em cascata:**
- Successor #0: promove após `heartbeatTimeoutMs` (default 6s)
- Successor #N: promove após `heartbeatTimeoutMs + N * cascadeStepMs` (default +2s por posição)
- Heartbeat recebido durante espera cancela promoção

**Split-brain:** epoch maior vence; mesmo epoch → peerId lexicograficamente menor vence; perdedor chama `onDemoted`

**Defaults:** `heartbeatIntervalMs=2000`, `heartbeatTimeoutMs=6000`, `cascadeStepMs=2000`

### `socket/socket.ts`
Re-exporta `UdpTransport` como `UdpSocketImpl` para compatibilidade com código antigo. Pode ser ignorado.

---

## Fluxo completo — UdpTransport

```
Eden.emit("eden:user:created", payload)
  → Emitter.emit()
      → createEnvelope() — valida type, gera UUID v4
      → PendingQueue.add(envelope)
      → UdpTransport.send() — pacote UDP para remote

Eden (receptor) — UdpTransport.bind() escuta porta
  → Receiver.handle(msg)
      → parse JSON + valida campos id e type
      → handler(envelope) em eden.ts:
          → type === "__ack__"? → emitter.acknowledge(id) → return
          → senão → Bus.publish(envelope)
              → Deduplicator.seen(id) — descarta duplicata
              → roteia por type + room
              → chama handlers registrados via .on()
      → type !== "__ack__"? → envia ACK via ackSocket

Emitter (retry automático a cada retryIntervalMs)
  → PendingQueue.getExpired()
  → reenvia via socket
  → Receiver descarta pelo Deduplicator (id já visto)
```

## Fluxo completo — P2PTransport

```
P2PTransport.connect(targetPeerId)
  1. Cria socket UDP, bind(0) → porta efêmera
  2. StunClient.discover() → endpoint público {host, port}
     (pula se stunServers=[])
  3. SignalingClient.register(peerId, endpoint, publicKey?)
  4. SignalingClient.requestConnect(myId, targetPeerId) → { endpoint, publicKey? }
     (retry 5× com 200ms delay — peer pode ainda não ter registrado)
  5. Se requestConnect falha → setupRelay() e retorna
  6. HolePuncher.punch(remoteEndpoint) → bool
     (pula se punchTimeoutMs=0)
  7. punched=true → this.peerEndpoint = remoteEndpoint (UDP direto)
     punched=false → setupRelay()

P2PTransport.send(msg)
  → this.relay? → relay.send(msg) via WebSocket → signaling server → peer
  → senão → socket.send(msg, peerEndpoint.port, peerEndpoint.host) — UDP direto

P2PTransport.bind(_, onMessage)
  → Filtra PROBE_MAGIC do HolePuncher
  → Registra handler no socket UDP e/ou relay
```

## Fluxo completo — Mesh Flooding

```
Peer A emite mensagem M

  MeshRelay.emit(M):
    1. JSON.parse → adiciona ttl=10, origin="peer-a" se ausentes
    2. Deduplicator.seen(M.id) → marca como visto (não echo)
    3. transport.send(M) → fanout para vizinhos diretos

  Peer B recebe M via transport:
    1. MeshRelay.handleIncoming(M)
    2. Deduplicator.seen(M.id)? → descarta (loop)
    3. M.ttl <= 0? → descarta (expirou)
    4. Entrega M para a aplicação (onMessage)
    5. M.ttl - 1 > 0? → forward via transport.send() com ttl decrementado
       M.ttl - 1 <= 0? → não forward (último hop)

  Peer C recebe M (via B):
    → mesmo fluxo: deduplica, entrega, forward com ttl-1

  Loop A↔B↔C↔A:
    → Deduplicator descarta — M.id já visto

  ACKs e mensagens de controle:
    → ACKs passam pro app mas NÃO são forwarded
    → Non-JSON (probes, heartbeats) passam como-is sem forwarding
```

## Fluxo completo — Roteamento (server vs mesh)

```
Aplicação quer enviar mensagem:

  1:1 para peer específico:
    MessageRouter.send(targetPeerId, payload)
      → server.isConnected()? → server.send(targetPeerId, payload) — 1 hop via WS
      → server.send() falhou? → mesh.emit(payload) — multi-hop flooding
      → server offline? → mesh.emit(payload)

  Broadcast global:
    MessageRouter.broadcast(payload)
      → mesh.emit(payload) — sempre flooding

  Room (poucos membros):
    RoomManager.sendToRoom(roomId, payload)
      → members < broadcastThreshold → N × router.send(member, payload) — N sends 1:1
      → members >= broadcastThreshold → router.broadcast(payload) — flooding

  Join/Leave room:
    RoomManager.join(roomId)
      → para cada membro existente → router.send(member, __room_join__)
    RoomManager.leave(roomId)
      → para cada membro restante → router.send(member, __room_leave__)
```

## Fluxo completo — Eleição de Sentinela

```
MultiP2PTransport com sentinel=true:

  Primeiro addPeer() bem-sucedido:
    → Cria SentinelElection + SignalingSentinel
    → election.startAsSentinel() → epoch=1, heartbeat imediato
    → Heartbeats enviados via transport.send() (fanout UDP/relay)

  Peers subsequentes com sentinel=true:
    → Recebem heartbeats via bind() → filtrados por SENTINEL_HEARTBEAT_MAGIC
    → election.handleHeartbeat() → armazena sentinelId, reseta timeout
    → Ficam em standby como followers

  Sentinel morre (close/crash):
    → Followers param de receber heartbeats
    → Successor #0 promove após heartbeatTimeoutMs → onPromoted()
      → Cria novo SignalingSentinel + começa heartbeats (epoch+1)
    → Successors #1..N cancelam ao receber heartbeat do novo sentinel

  Split-brain (dois sentinels simultâneos):
    → Heartbeat com epoch maior vence
    → Mesmo epoch → peerId lexicograficamente menor vence
    → Perdedor: onDemoted() → sentinel.stop(), sentinel=null

  Mesh morta (peers.size === 0):
    → election.stop(), election=null — sem sentido ser sentinel sozinho
```

---

## Estrutura de arquivos

```
src/
  __tests__/
    integration/              ← testes com rede real (npm run test:integration)
  eden/eden.ts                ← API pública principal
  errors/errors.ts
  envelope/envelope.ts
  emitter/emitter.ts
  receiver/receiver.ts
  bus/bus.ts
  deduplicator/deduplicator.ts
  pending-queue/pending-queue.ts
  socket/socket.ts            ← re-export de compatibilidade
  crypto/
    box.ts                    ← encrypt/decrypt NaCl box (Curve25519 + XSalsa20 + Poly1305)
    identity.ts               ← createIdentity + derivePeerId (SHA-256)
  mesh/
    mesh-relay.ts             ← flooding multi-hop (dedup, TTL, forwarding)
  routing/
    message-router.ts         ← decisão server vs mesh
    room-manager.ts           ← membership de rooms no peer
  transports/
    transport.ts              ← interface EdenTransport + Endpoint
    udp/udp-transport.ts      ← implementação padrão (node:dgram)
    udp/multi-udp-transport.ts ← socket único para N peers (fanout)
    p2p/p2p-transport.ts      ← NAT traversal (STUN + hole punch + relay)
    p2p/multi-p2p-transport.ts ← socket único + NAT traversal por peer (N peers, 1 fd)
  stun/
    stun-message.ts           ← RFC 5389 builder/parser
    stun-client.ts            ← descobre endpoint público
  signaling/
    signaling-client.ts       ← WebSocket para troca de endpoints + publicKey
    signaling-sentinel.ts     ← conexão persistente com signaling (reconexão automática)
  sentinel/
    sentinel-election.ts      ← eleição peer-to-peer (heartbeat + cascata + split-brain)
  hole-punch/
    hole-puncher.ts           ← UDP hole punching com grace period
  relay/
    relay-client.ts           ← fallback WebSocket transparente (send/message, join)
  index.ts                    ← exports públicos
bench/
  transport.bench.ts          ← npm run bench
docs/
  ARCHITECTURE.md             ← decisões detalhadas de arquitetura
```

---

## TDD — Regras
- Nenhuma linha de produção sem teste falhando antes
- Ciclo: Red → Green → Refactor
- Testes unitários: fake socket / mock, sem I/O real
- Testes de integração (UDP real): `src/__tests__/integration/` — `npm run test:integration`
- Testes de integração (rede real): `stun-client.integration.test.ts` — CI não roda, só local
- **222 testes passando** (29 test suites)

---

## Distribuição
- `@eden_labs/tree` — NPM público, ESM puro, TypeScript com exports de tipos
- Versão atual: `0.7.0`
- Dependências runtime: `uuid`, `ws`, `tweetnacl`
- SDKs para outras linguagens = repos separados implementando o mesmo protocolo de envelope

---

## Performance (loopback 127.0.0.1)

### Transport — ping-pong sequencial (RTT)

| Transport | p50 | p95 | Throughput |
|-----------|-----|-----|------------|
| UdpTransport (baseline) | 0.049 ms | 0.085 ms | ~15,000 msg/s |
| P2PTransport hole punch | 0.049 ms | 0.074 ms | ~16,300 msg/s |
| P2PTransport relay | 0.095 ms | 0.145 ms | ~8,900 msg/s |
| MultiP2PTransport hole punch | 0.034 ms | 0.080 ms | ~23,400 msg/s |

Overhead do hole punch pós-conexão é negligenciável. Relay tem ~2× overhead por usar TCP/WebSocket.

### Crypto — encrypt/decrypt (NaCl box)

| Payload | encrypt | decrypt |
|---------|---------|---------|
| 64B | ~2,030 ops/s (0.49ms) | ~2,040 ops/s (0.49ms) |
| 256B | ~2,020 ops/s (0.50ms) | ~2,034 ops/s (0.49ms) |
| 1024B | ~2,007 ops/s (0.50ms) | ~2,001 ops/s (0.50ms) |
| 4096B | ~1,915 ops/s (0.52ms) | ~1,915 ops/s (0.52ms) |

Throughput praticamente constante até 4KB — o custo é dominado pela cripto, não pelo tamanho do payload.

### MeshRelay — overhead vs direct

| Caminho | Throughput |
|---------|-----------|
| Direct (sem mesh) | ~1,318,000 msg/s |
| MeshRelay | ~554,000 msg/s |

Overhead de ~138% em CPU puro (JSON parse/stringify duplo + deduplicação). Em rede real esse overhead é negligenciável: o processamento do MeshRelay leva ~0.002ms enquanto a latência de rede é ~0.05-0.1ms (25-50× maior).

### Fanout — MultiUdpTransport (1 socket) vs N UdpTransport (N sockets)

| N peers | MultiUdp p50 | NxUdp p50 | Overhead |
|---------|-------------|-----------|----------|
| 10 | 0.089 ms | 0.089 ms | ~0% |
| 50 | 0.407 ms | 0.404 ms | ~1% |
| 200 | 1.690 ms | 1.725 ms | ~-2% |

Socket único é equivalente a N sockets em desempenho, mas usa 1 fd vs N.

---

## Decisões Fechadas

### Protocolo e entrega
- [x] UDP puro via `node:dgram` — sem Socket.IO, sem WebSocket no caminho principal
- [x] At-least-once + idempotent consumer (deduplicação por UUID v4)
- [x] Retry automático no Emitter via setInterval
- [x] ACK automático no Receiver — NÃO para mensagens `type === "__ack__"` (evita cascata)
- [x] ACKs interceptados em `eden.ts` antes do Bus → `emitter.acknowledge(id)` (não `bus.publish`)
- [x] `Eden` como API principal — encapsula toda complexidade interna
- [x] Broadcast global (room ausente) + rooms opcionais
- [x] Erros tipados com hierarquia `EdenError`
- [x] Envelope com `ttl` e `origin` opcionais (backward compatible)

### Transport plugável
- [x] Interface `EdenTransport` permite outros transportes sem mudar Emitter/Receiver
- [x] `Eden` recebe `transport?: (target) => EdenTransport` — default `UdpTransport`
- [x] `UdpTransport.close()` idempotente — factory pode retornar mesma instância 3× para ackSocket/listenSocket/emitSocket
- [x] Mesma idempotência em `P2PTransport.close()`
- [x] `MultiUdpTransport` — socket único para N peers; overhead <2% vs N UdpTransport
- [x] `MultiP2PTransport` — socket único + NAT traversal por peer; `maxPeers` (default 10)

### NAT Traversal
- [x] STUN RFC 5389 do zero (zero deps externas) — `stun-message.ts`
- [x] Hole punching com grace period de 300ms para simetria de NAT
- [x] HolePuncher filtra por `rinfo` (address+port) e remove listener via `socket.off()` após resolver
- [x] `stunServers: []` pula STUN; `punchTimeoutMs: 0` pula hole punch
- [x] Relay via WebSocket signaling server — fallback para NAT simétrico estrito
- [x] Relay `send()` faz queue se WS ainda não abriu (sem race condition)
- [x] `StunClient` suporta `keepAlive: true` e `prebound: true` para socket compartilhado

### Protocolo de sinalização (novo)
- [x] `register()` aceita e envia `publicKey` — peer usa pra criptografia, sem passo extra
- [x] `requestConnect()` retorna `ConnectResult { endpoint, publicKey? }` — não mais só `Endpoint`
- [x] `RelayClient` usa `send`/`message` (não mais `relay`/`data`)
- [x] `RelayClient` envia `join` em vez de `identify` — WS associado ao peerId no join
- [x] `MultiP2PTransport.addPeer()` aceita `publicKey`, armazena via `getPublicKey(peerId)`
- [x] Fix `MaxListenersExceededWarning` — listener removido no timeout do `requestConnect`

### Sentinel e Eleição
- [x] `SignalingSentinel` — conexão persistente com signaling server; reconexão com exponential backoff
- [x] `SignalingSentinel.stop()` adiciona error handler no-op após `removeAllListeners()` antes de `terminate()`
- [x] `SentinelElection` — eleição peer-to-peer sem mudanças no signaling server
- [x] Heartbeat via transport layer com prefixo mágico `SENTINEL_HEARTBEAT_MAGIC`
- [x] Sucessão em cascata: successor #N espera `timeoutMs + N * cascadeStepMs`
- [x] Split-brain: epoch maior vence; mesmo epoch → peerId menor vence
- [x] `removePeer()` com `peers.size === 0` para election — mesh morta

### Broadcast Mesh
- [x] `MeshRelay` — camada de flooding separada do transport (composição, não herança)
- [x] Flooding com deduplicação por UUID + TTL como defesa em profundidade (default 10 hops)
- [x] ACKs e mensagens de controle (probes, heartbeats) NÃO propagados pela mesh
- [x] Mesh é opt-in — Eden sem MeshRelay funciona normalmente

### Roteamento e Rooms
- [x] `MessageRouter` decide server vs mesh automaticamente — fallback transparente
- [x] Broadcast sempre via mesh (flooding)
- [x] `RoomManager` — membership local, anúncios via router.send
- [x] Small rooms → N sends 1:1; large rooms → broadcast
- [x] Server não sabe de rooms — toda lógica no peer

### Criptografia
- [x] NaCl box (Curve25519 + XSalsa20 + Poly1305) via `tweetnacl` — zero deps nativas
- [x] Formato: `[ nonce (24 bytes) | ciphertext ]` — nonce aleatório a cada chamada
- [x] `decrypt` retorna `null` (não lança) para chave errada, buffer corrompido ou < 24 bytes
- [x] `createIdentity` persiste par de chaves com permissões seguras (dir 0o700, file 0o600)
- [x] `derivePeerId` = SHA-256 hex da publicKey — determinístico, 64 chars

### Multi-linguagem
- [x] SDKs para outras linguagens = repos separados com mesmo protocolo de envelope

# Broadcast Mesh no ecossistema Eden

## Objetivo

Hoje cada peer só se comunica com peers conectados diretamente. Com limite de ~10 conexões por nó, a rede é fragmentada. A mesh resolve isso: mensagens pulam entre peers intermediários até alcançar toda a rede.

```
Peer 1 ←→ Peer 2 ←→ Peer 3 ←→ Peer 4
            ↕
          Peer 5
```

Peer 1 quer falar com Peer 4:
```
Peer 1 → Peer 2 → Peer 3 → Peer 4
```

Peer 1 não conhece Peer 4. Não tem conexão direta. Mas Peer 2 conhece ambos — e repassa.

---

## Estratégia: Flooding

Cada peer que recebe uma mensagem repassa para todos os seus vizinhos. Todos os peers da rede acabam recebendo. Loops são evitados pelo `Deduplicator` (seen set por UUID v4) que já existe no Eden.

**Por que flooding e não roteamento?**

- O Eden é pub/sub — `.on("eden:chat:message")` = todo mundo que assinou recebe. Flooding é literalmente isso, só que multi-hop.
- Sem estado de rota — nenhum peer precisa conhecer a topologia. Entra, conecta em alguns vizinhos, e participa.
- Resiliente — caiu um peer? A mensagem chega por outro caminho.
- Criptografia resolve privacidade — todo mundo recebe, só quem tem a chave decripta.
- Simples de implementar — o Deduplicator e o envelope com UUID já existem.

---

## O que muda no envelope

Dois campos novos, ambos opcionais (backward compatible):

```ts
{
  id: string;          // já existe — chave de deduplicação (mata loops)
  type: string;        // já existe
  payload: unknown;    // já existe
  timestamp: number;   // já existe
  version: string;     // já existe
  room?: string;       // já existe
  ttl?: number;        // NOVO — hops restantes (default 10, decrementa a cada hop)
  origin?: string;     // NOVO — peerId do emissor original
}
```

### TTL (Time To Live)

Limita quantos hops a mensagem percorre. Sem TTL, flooding em rede com ciclos depende só do Deduplicator — funciona, mas gasta bandwidth. TTL é defesa em profundidade.

- Peer emite com `ttl: 10` (default)
- Cada hop decrementa: `ttl: 9`, `ttl: 8`, ...
- `ttl <= 0` → descarta, não repassa
- Deduplicator continua ativo como segunda camada

### Origin

peerId de quem originou a mensagem. Útil para:
- Saber quem mandou (aplicação pode usar pra decrypt seletivo)
- Peer não repassa de volta pro origin se for vizinho direto (otimização)

---

## Fluxo de forwarding

```
Peer A emite mensagem M (ttl=10, origin=A)
  → send() para todos os vizinhos diretos

Peer B recebe M
  1. Deduplicator.seen(M.id)? → descarta (loop)
  2. M.ttl <= 0? → descarta (expirou)
  3. Marca M.id como visto
  4. Entrega M para a aplicação (onMessage / Bus.publish)
  5. Decrementa ttl: M.ttl - 1
  6. Repassa M para todos os vizinhos EXCETO quem mandou

Peer C recebe M (via B)
  → mesmo fluxo: deduplica, entrega, repassa com ttl-1

Peer D recebe M (via C)
  → mesmo fluxo
  → se D também receber M de outro caminho, Deduplicator descarta
```

---

## Onde fica a lógica de mesh

Nova camada: `MeshRelay` (`src/mesh/mesh-relay.ts`).

Não fica no transport (que só sabe enviar/receber bytes) e não fica no Eden (que é API de aplicação). É uma camada intermediária entre os dois.

```
Eden (API)
  ↕
MeshRelay (forwarding, deduplication, TTL)
  ↕
MultiP2PTransport (peers diretos, NAT traversal)
```

### MeshRelay

```ts
interface MeshRelayOptions {
  transport: MultiP2PTransport;
  peerId: string;
  maxTtl?: number;           // default 10
  onMessage: (msg: Buffer) => void;  // entrega pra aplicação
}
```

- **Recebeu mensagem do transport:**
  1. Parse JSON → extrai `id`, `ttl`, `origin`
  2. `seen(id)` → descarta
  3. `ttl <= 0` → descarta
  4. Entrega pra aplicação (`onMessage`)
  5. Forward: `ttl - 1`, `send()` via transport (fanout pra todos os peers)

- **Aplicação quer emitir:**
  1. Envelope já vem pronto do Emitter
  2. MeshRelay adiciona `ttl: maxTtl` e `origin: peerId` se ausentes
  3. Marca `id` como visto (não processa própria mensagem de volta)
  4. `send()` via transport

### Por que MeshRelay separado e não dentro do MultiP2PTransport

- **Separação de responsabilidades** — transport cuida de NAT traversal e envio/recepção de bytes. Mesh cuida de forwarding. São concerns ortogonais.
- **Composição** — mesh funciona com qualquer transport (MultiP2PTransport, MultiUdpTransport, futuro transport). Não polui o transport com lógica de roteamento.
- **Opt-in** — nem todo uso precisa de mesh. Um peer que fala só com vizinhos diretos continua usando o transport puro.

---

## Limite de peers

Cada peer conecta em no máximo ~10 vizinhos diretos. Isso é configurável via `maxPeers` no MultiP2PTransport.

- `addPeer()` com `peers.size >= maxPeers` → rejeita (lança erro ou retorna)
- A mesh garante que mesmo com 10 conexões, toda a rede é alcançável via hops

**Topologia mínima pra mesh funcionar:** cada peer precisa de pelo menos 2 conexões (pra ter redundância). Com 1 conexão, se o vizinho cai, o peer fica isolado.

---

## Deduplicação — o que já existe vs o que precisa

| Componente | Já existe | Precisa |
|---|---|---|
| `Deduplicator` (seen set por ID) | sim | reusar ou criar instância separada pro MeshRelay |
| UUID v4 no envelope | sim | nada — cada mensagem já tem ID único |
| TTL no envelope | não | campo novo, default 10 |
| Origin no envelope | não | campo novo, peerId do emissor |
| Forward logic | não | MeshRelay |

---

## ACK na mesh

ACKs (`type: "__ack__"`) **NÃO são propagados pela mesh**. Motivos:

- ACK é entre peers diretos — "eu recebi sua mensagem". Não faz sentido Peer C confirmar recebimento de uma mensagem que Peer A mandou pra Peer B.
- Propagar ACK por flooding geraria N ACKs por mensagem (um por peer na mesh) — inviável.
- O at-least-once delivery continua funcionando entre peers diretos. A mesh garante que a mensagem chega, mas cada hop é independente.

---

## Heartbeats e mensagens de controle na mesh

Heartbeats de sentinel (`SENTINEL_HEARTBEAT_MAGIC`) e probes (`PROBE_MAGIC`) **NÃO são propagados pela mesh**. São mensagens de controle entre vizinhos diretos.

O MeshRelay propaga apenas mensagens de aplicação (envelopes JSON com `id`, `type`, `payload`).

---

## Exemplo: como fica o uso

```javascript
import { MultiP2PTransport, MeshRelay, Eden } from "@eden_labs/tree"

// Setup transport com limite de peers
const transport = new MultiP2PTransport({
  sentinel: true,
  maxPeers: 10,
})

// Setup mesh relay
const mesh = new MeshRelay({
  transport,
  peerId: myId,
  maxTtl: 10,
})

// Eden usa mesh como intermediário
const eden = new Eden({
  transport: () => mesh,  // ou integrado internamente
})

eden.on("eden:chat:message", (envelope) => {
  // recebe mensagens de qualquer peer na mesh,
  // não apenas vizinhos diretos
  console.log(envelope.payload)
})

// Broadcast — mesh flooding pra toda a rede
eden.emit("eden:chat:message", { text: "hello mesh!" })

// 1:1 — send direto pelo server se disponível, mesh se não
eden.send("peer-bob", "eden:chat:dm", { text: "oi bob" })
```

---

## Mesh vs Server — dois caminhos de entrega

A mesh não é o único caminho. Quando o signaling server está disponível, o peer pode enviar mensagens diretamente via server (send 1:1). A mesh é o fallback resiliente.

### Quem decide o caminho?

O peer/tree decide automaticamente:
1. **Server up + mensagem 1:1** → send direto pelo server (rápido, uma entrega)
2. **Server up + room pequena (5-50 peers)** → N sends 1:1 pelo server (peer conhece os membros)
3. **Server down ou broadcast global** → mesh flooding (resiliente, multi-hop)

O server nunca sabe de rooms. Peers gerenciam membership localmente e anunciam entrada/saída via server (send 1:1) ou mesh (fallback).

> Referência completa do server: `../BRANCH_PRD.md`

---

## O que a mesh NÃO resolve (e tudo bem)

- **Eficiência de bandwidth** — toda mensagem passa por todos os nós no flooding. Pra event bus com JSON pequeno, é irrelevante. Pra rooms pequenas, o send direto pelo server é mais eficiente.
- **Discovery automático** — peers ainda precisam saber o endereço de pelo menos um vizinho pra entrar na mesh. Discovery é problema do signaling server, não do transport.

---

## Arquivos

### Novos
- `src/mesh/mesh-relay.ts` — lógica de flooding: deduplicação, TTL, forwarding
- `src/__tests__/mesh-relay.test.ts` — testes unitários (mock transport)

### Modificados
- `src/envelope/envelope.ts` — campos `ttl` e `origin` opcionais no `EventEnvelope`
- `src/transports/p2p/multi-p2p-transport.ts` — opção `maxPeers`
- `src/index.ts` — export `MeshRelay`
- `CLAUDE.md` — novo módulo `mesh/`

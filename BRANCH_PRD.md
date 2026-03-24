# @eden_labs/branch — PRD (Product Requirements Document)

> Signaling server genérico para redes P2P. Facilita conexão entre peers, não gerencia a rede.

---

## Filosofia

- **Server é burro** — não guarda estado de aplicação. Peers são a fonte de verdade.
- **Server é dispensável** — se cair, a rede continua via mesh. Quando volta, peers hidratam ele.
- **Server é horizontal** — sem estado pesado em memória, pode levantar N instâncias atrás de load balancer.
- **Server não sabe o que é Eden** — protocolo genérico, qualquer rede P2P pode usar.
- **Sem auth** — criptografia resolve confiança na camada de cima (decrypt falha se chave errada, mensagem descartada).

---

## Responsabilidades

### 1. Porteiro — registro e descoberta de peers

O server mantém um `known` set persistido em disco: quem já entrou na rede.

- Peer faz join → entra no `known` com timestamp de último contato
- Peer reconecta → timestamp atualizado
- Peer novo chega → server retorna uma **amostra** dos known (ex: ~50 peers recentes), não a lista completa
- Limpeza periódica: peers que não reconectam há X tempo são removidos (configurável)

**Dados persistidos por peer:**
- `peerId`
- `publicKey`
- `lastSeen` (timestamp)

**Dados em memória (voláteis):**
- `ws` (conexão WebSocket atual)
- `endpoint` (host:port, registrado via STUN)

### 2. Troca de endpoints — viabiliza hole punch

Peers registram seu endpoint público (descoberto via STUN) e pedem o endpoint de outros peers pra iniciar hole punching.

### 3. Send direto — entrega 1:1

Quando um peer quer mandar mensagem pra outro peer específico, o server entrega diretamente se o target tem WS aberto. Payload é opaco (server não lê conteúdo).

Isso unifica o relay atual (fallback NAT) com roteamento direto — é a mesma operação: receber payload, entregar pro target.

---

## O que o server NÃO faz

- **Não gerencia rooms/channels** — rooms são conceito do tree/aplicação. Peers gerenciam membership.
- **Não gerencia criptografia** — só guarda e distribui publicKey como metadata do peer.
- **Não gerencia topologia da mesh** — peers decidem com quem conectar.
- **Não roteia pra grupos** — só faz entrega 1:1. Multicast é orquestrado pelos peers.
- **Não autentica** — qualquer peer pode se registrar. Confiança é validada via criptografia peer-to-peer.

---

## Estratégia de entrega de mensagens (escala 100k+)

O server só faz entrega **1:1**. A inteligência de "pra quem enviar" fica no peer.

### Mensagem pra um peer específico
```
Peer A → server (send, target: B) → Peer B
```
Direto. Uma mensagem, uma entrega.

### Mensagem pra uma room (poucos membros, ex: 5-50)
```
Peer A sabe que room "xyz" tem B, C, D, E
Peer A → server (send, target: B) → Peer B
Peer A → server (send, target: C) → Peer C
Peer A → server (send, target: D) → Peer D
Peer A → server (send, target: E) → Peer E
```
Peer A manda N sends 1:1. Server continua burro — só entrega.

### Broadcast global ou room gigante
```
Peer A → mesh flooding → vizinhos → vizinhos → toda a rede
```
Mesh resolve via hops. Cada peer repassa pra ~10 vizinhos (maxPeers). Com 100k peers, são ~5 hops pra alcançar todos. Server não participa.

### Server offline
```
Tudo vai pela mesh — 1:1, rooms, broadcast. Mais lento, mas funciona.
```

### Quem decide o caminho?
O peer/tree decide:
1. Server tá up? → send direto pelo server (rápido)
2. Server tá down? → mesh flooding (fallback)

O branch não sabe qual estratégia o peer escolheu. Ele só recebe `send` e entrega.

---

## Room membership — responsabilidade do peer

O server não sabe o que é uma room. Peers gerenciam membership localmente.

### Como peers sabem quem tá na room

Quando um peer entra ou sai de uma room, ele avisa os outros membros:

1. **Tenta server** (rápido) — manda `send` 1:1 pra cada membro: "eu entrei/saí da room xyz"
2. **Fallback mesh** — se server offline, anuncia pela mesh flooding

### maxPeers por room

Rooms têm limite configurável de membros (definido pela aplicação/tree, não pelo server). Peer mantém lista local dos membros de cada room que participa.

### Persistência de membership

Cada peer salva localmente as rooms que participa e os membros conhecidos. Na reconexão (ao server ou à mesh), reanuncia sua presença nas rooms.

**Toda essa lógica é do tree/aplicação — o branch não sabe que rooms existem.**

---

## Protocolo

### Descoberta de peers

```
cliente → server:  { type: "join", peerId, publicKey }
server → cliente:  { type: "joined", peers: [{ peerId, publicKey }, ...] }  ← amostra dos known
server → online:   { type: "peer_connected", peerId, publicKey }           ← broadcast pros conectados
server → online:   { type: "peer_disconnected", peerId }                   ← informativo
```

**Nota:** `joined` retorna amostra (ex: ~50), priorizando peers com `lastSeen` recente. Não retorna 100k ids.

### Troca de endpoints (hole punch)

```
cliente → server:  { type: "register", peerId, endpoint: { host, port } }
server → cliente:  { type: "registered" }
cliente → server:  { type: "request_connect", myId, targetId }
server → cliente:  { type: "peer_endpoint", peerId, endpoint, publicKey }
              ou:  { type: "error", reason: "peer_not_found" }
```

**Nota:** `peer_endpoint` agora inclui `publicKey` do target — peer usa pra criptografia, sem passo extra.

### Send direto

```
cliente → server:  { type: "send", targetPeerId, payload }
server → target:   { type: "message", fromPeerId, payload }
```

Target offline → server descarta silenciosamente (peer sender deve ter fallback via mesh).

**Nota:** `identify` não é mais necessário. O server associa o WS ao peerId no `join`. Qualquer peer que fez join pode receber mensagens.

### Reconexão (peer hidrata o server)

```
Peer reconecta após server restart:
  1. Abre WS
  2. Envia { type: "join", peerId, publicKey }     ← server reaprende quem ele é
  3. Envia { type: "register", peerId, endpoint }   ← server reaprende seu endpoint
  4. Pronto — server reconstruiu estado desse peer
```

Rooms/channels/subscriptions NÃO existem no server — nada a reconstruir além do básico.

---

## Dados

### Persistência em disco

```json
{
  "peers": {
    "peer-abc": { "publicKey": "...", "lastSeen": 1711100000000 },
    "peer-xyz": { "publicKey": "...", "lastSeen": 1711099000000 }
  }
}
```

- Salvo a cada novo join (ou batch periódico pra performance)
- Limpeza configurável (ex: remove peers sem contato há 30 dias)

### Estado em memória

```
online: Map<peerId, { ws, endpoint, publicKey }>   ← peers com WS aberto agora
```

Isso é tudo. Sem channels, sem subscriptions, sem filas.

---

## Escalabilidade horizontal

O server guarda pouco estado:
- **Disco:** `known` set (peerId + publicKey + lastSeen) — leve
- **Memória:** `online` map (só peers conectados) — proporcional a conexões WS

Para múltiplas instâncias:
- `known` pode ir pra um store compartilhado (Redis, SQLite, etc.) no futuro
- `online` é local por instância (cada server sabe quem tá conectado nele)
- Send pra peer em outra instância → precisa de pub/sub entre servers (ex: Redis pub/sub) — **fase futura, não agora**

---

## Mudanças em relação ao branch atual

| Antes | Depois |
|-------|--------|
| `known` cresce infinitamente | `known` com `lastSeen` + limpeza periódica |
| `joined` retorna todos os known | `joined` retorna amostra (~50 recentes) |
| `join` não envia publicKey | `join` inclui `publicKey` |
| `peer_endpoint` retorna só endpoint | `peer_endpoint` inclui `publicKey` |
| `identify` necessário pra relay | `identify` removido — WS associado no `join` |
| `relay` + `data` como tipos separados | Unificado em `send` + `message` |
| Peer declara peerId livremente | Sem mudança (sem auth, crypto valida) |

---

## O que fica pra depois

- **Múltiplas instâncias** — pub/sub entre servers pra roteamento cross-instance
- **Rate limiting** — proteger contra spam de join/send
- **Métricas** — peers online, mensagens/segundo, known size
- **TLS** — wss:// em produção
- **Known em store externo** — Redis/SQLite quando JSON file não escalar

---

## Arquivos esperados

```
server.js              ← servidor (factory function com DI)
test/server.test.js    ← testes (TDD, node:test, storage injetável)
data/known-peers.json  ← persistência (runtime, gitignored)
package.json
```

# Eden Core — Architecture Decisions

> Documento vivo. Atualizado a cada decisão arquitetural relevante.
> Última atualização: 2026-03-19

---

## 1. Visão Geral

Eden Core é o gerenciador de eventos do ecossistema Eden. A API pública é a classe `Eden`, que encapsula transporte, serialização, roteamento e deduplicação.

**Princípio central:** qualquer módulo que não seja `socket/` ou `transports/` não conhece o protocolo de transporte. Trocamos o transporte sem tocar em `Emitter`, `Receiver` ou `Bus`.

---

## 2. Decisões de Transporte

### 2.1 — Pluggable Transport via `EdenTransport` (2026-03-19)

**Decisão:** Renomear a interface `UdpSocket` para `EdenTransport` e generalizar sua assinatura para suportar múltiplos transportes (UDP, WebRTC, P2P customizado, etc).

**Motivação:** O sistema precisa funcionar em ambientes distintos:
- Ambiente controlado (mesma LAN, mesmo host) → UDP puro, zero overhead
- P2P entre redes diferentes → precisa de NAT traversal

A interface permite que o usuário traga o próprio transporte sem mudar nada no core.

**Interface:**
```ts
interface EdenTransport {
  send(msg: Buffer, target?: Endpoint): Promise<void>
  bind(port: number, onMessage: (msg: Buffer, from: Endpoint) => void): Promise<void>
  close(): Promise<void>
}

interface Endpoint {
  host: string
  port: number
}
```

**Transportes incluídos no pacote:**
- `UdpTransport` — wrapper sobre `node:dgram`, default para ambientes controlados
- `MultiUdpTransport` — socket único para N peers simultâneos (fanout, ver seção 2.3)
- `P2PTransport` — UDP + STUN + hole punching + relay fallback (ver seção 3)

---

### 2.2 — MultiUdpTransport: socket único para N peers (2026-03-20)

**Decisão:** Adicionar `MultiUdpTransport` que mantém um único socket `dgram` independente de quantos peers estão registrados.

**Motivação:** `UdpTransport` cria um socket por destino. Em cenários hub-and-spoke (1 processo se comunicando com N peers), isso significa N file descriptors, N handles no event loop e N binds. `MultiUdpTransport` resolve isso com 1 socket + Map de endpoints.

**API:**
```ts
const hub = new MultiUdpTransport();
hub.addPeer({ host, port });   // registra peer
hub.removePeer({ host, port }); // remove peer
hub.send(msg);                 // fanout para todos os peers
hub.bind(port, onMessage);     // escuta qualquer origem
hub.close();                   // limpa peers + fecha socket
```

**Resultado do benchmark (fanout tail latency, loopback):**

| N peers | MultiUdpTransport | N × UdpTransport | overhead |
|---------|-------------------|------------------|---------|
| 10 | 0.104 ms | 0.104 ms | ~0% |
| 50 | 0.474 ms | 0.465 ms | ~2% |
| 200 | 1.881 ms | 1.895 ms | ~0% |

O overhead de latência é negligenciável. O ganho real é de recursos: 1 fd vs N, independente do tamanho da rede.

**Detalhe de implementação:** `close()` chama `peers.clear()` antes de fechar o socket. Isso garante que o Map não retém referências de endpoints após o transporte ser encerrado, e torna `send()` seguro sem necessidade de checar estado do socket (peers vazios = loop não executa).

---

### 2.3 — P2P Transport Customizado (2026-03-19)

**Decisão:** Não usar WebRTC. Implementar NAT traversal customizado sobre UDP puro, similar ao que engines de jogos fazem (ENet, GameNetworkingSockets).

**Motivação:**
- WebRTC tem overhead de DTLS + SCTP para casos onde não precisamos de criptografia obrigatória
- WebRTC foi desenhado para browsers — nós somos Node.js
- Controle total sobre o protocolo, sem dependências externas pesadas
- Performance máxima para o ecossistema Eden

**Por que não QUIC:**
- `node:quic` ainda experimental (Node 23+)
- QUIC resolve NAT rebinding mas não o problema inicial de hole punching
- Para P2P real entre dois NATs, QUIC sozinho não é suficiente

**Componentes do P2P Transport:**

```
P2PTransport
  ├── StunClient       → descobre IP:porta público (RFC 5389)
  ├── HolePuncher      → abre NAT sincronizadamente
  ├── SignalingClient  → troca endpoints com peers via servidor leve
  └── RelayClient      → fallback quando hole punching falha (NAT simétrico)
```

---

## 3. Protocolo STUN Customizado

**Decisão:** Implementar cliente STUN do zero, sem biblioteca externa.

**Motivação:** STUN (RFC 5389/8489) é um protocolo simples o suficiente para implementar em ~100 linhas. Zero dependências, comportamento controlado.

**Como funciona:**
1. Cliente envia `Binding Request` (20 bytes de header) para servidor STUN público
2. Servidor responde com `Binding Response` contendo `XOR-MAPPED-ADDRESS`
3. Cliente extrai IP:porta público do atributo e sabe como é visto de fora do NAT

**Servidores STUN usados (sem custo, sem autenticação):**
- `stun.l.google.com:19302`
- `stun1.l.google.com:19302`
- `stun.cloudflare.com:3478`

**Estrutura da mensagem STUN:**
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|0 0|  Message Type             |         Message Length        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Magic Cookie (0x2112A442)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                    Transaction ID (96 bits)                   |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

---

## 4. Hole Punching

**Decisão:** Implementar UDP hole punching coordenado por signaling server leve.

**Motivação:** É o mecanismo central que permite P2P real entre dois NATs. Sem isso, apenas peers com IP público podem se comunicar.

**Fluxo:**
```
Peer A (NAT A) ──► Signaling Server ◄── Peer B (NAT B)
     │                                        │
     │   1. Ambos registram endpoint público  │
     │   2. Signaling troca os endpoints      │
     │                                        │
     ▼                                        ▼
Peer A envia UDP pra B ◄────────────► Peer B envia UDP pra A
     │         (simultaneamente)              │
     └──────────── conexão P2P ──────────────┘
```

**Por que funciona:**
- Quando Peer A envia UDP para o IP público de B, o NAT de A cria uma entrada
- Quando Peer B responde, o NAT de A já tem a entrada e deixa passar
- A simultaneidade é coordenada pelo signaling server via timestamp

**Limitação conhecida:** NAT simétrico estrito (empresa, carrier-grade NAT) pode bloquear. Nesses casos o `RelayClient` assume automaticamente.

---

## 5. Relay Fallback

**Decisão:** Eden node com IP público pode atuar como relay transparente.

**Motivação:** ~15% dos casos de NAT simétrico não permitem hole punching. Sem relay, essas conexões falham silenciosamente. Com relay, degradam graciosamente.

**Diferença para WebRTC TURN:** o relay Eden conhece o protocolo de envelope, pode fazer roteamento inteligente por `room` e `type`, não é um proxy cego de bytes.

---

## 6. Estratégia de Conexão (Connection Strategy)

**Ordem de tentativa:**
```
1. Direct UDP (sem STUN)       → ambos na mesma rede
2. STUN + Hole Punching        → redes diferentes, NAT cone
3. Relay via Eden node         → NAT simétrico / fallback
```

Cada tentativa tem timeout configurável. O sistema tenta em paralelo e usa o primeiro que responder (similar ao Happy Eyeballs do TCP).

---

## 7. Identidade de Peer

**Decisão:** Cada peer tem um `peerId` único (UUID v4) gerado no primeiro boot e persistido localmente.

**Motivação:** O signaling server precisa de um identificador estável para rotear mensagens de coordenação. IP:porta público muda a cada sessão.

---

## 8. Invariantes do Sistema

- Nenhum módulo fora de `transports/` conhece detalhes de transporte
- `Emitter`, `Receiver`, `Bus` funcionam identicamente com qualquer `EdenTransport`
- Deduplicação por UUID permanece na camada de `Bus`, não no transporte
- TDD: nenhuma linha de produção sem teste falhando antes
- Zero dependências externas no core protocol (apenas `node:dgram` e `node:crypto`)

---

## 9. Estrutura de Arquivos (Target)

```
src/
  transports/
    udp/
      udp-transport.ts           ← wrapper node:dgram (atual socket.ts renomeado)
      udp-transport.test.ts
      multi-udp-transport.ts     ← socket único para N peers (fanout)
      multi-udp-transport.test.ts
    p2p/
      p2p-transport.ts           ← orquestra STUN + hole punch + relay
      p2p-transport.test.ts
    transport.ts                 ← interface EdenTransport + Endpoint
  stun/
    stun-client.ts               ← RFC 5389 implementado do zero
    stun-message.ts              ← build/parse de mensagens STUN
    stun-client.test.ts
  hole-punch/
    hole-puncher.ts
    hole-puncher.test.ts
  signaling/
    signaling-client.ts
    signaling-client.test.ts
  relay/
    relay-client.ts
    relay-client.test.ts
  eden/eden.ts                   ← aceita EdenTransport no construtor
  ... (demais módulos inalterados)
```

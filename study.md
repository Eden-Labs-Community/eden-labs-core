# study.md — Tópicos para estudar antes de dar direção ao eden-core

Esses tópicos vão te dar vocabulário e contexto para tomar decisões melhores sobre o que o core deve ou não deve fazer.

---

## 1. Delivery Guarantees (Garantias de Entrega)

Os três modelos existentes e quando cada um faz sentido:

- **At-most-once** — envia uma vez, se perder, perdeu. (fire and forget)
- **At-least-once** — reenvia até ter confirmação. Pode duplicar.
- **Exactly-once** — nunca duplica, nunca perde. Muito mais complexo de implementar.

O eden-core hoje usa **at-least-once + idempotent consumer** (receiver descarta duplicatas pelo ID). Isso simula exactly-once sem a complexidade real. Entender a diferença vai te dizer se isso é suficiente para os seus casos de uso.

**Pergunta que você precisa responder:** eventos do Eden podem ser processados duas vezes sem problema (ex: notificação, log)? Ou causam dano real (ex: débito financeiro, envio de email)?

---

## 2. ACK (Acknowledgement)

O que é, por que existe, e o que acontece quando não existe.

- Quem envia o ACK? O receptor da mensagem ou o broker?
- O que fazer quando o ACK não chega? (timeout + retry)
- O que fazer quando o ACK chega, mas a mensagem já foi reenviada?
- **Conceito relacionado:** NACK (negative acknowledgement) — rejeição explícita

---

## 3. Pub/Sub vs. Message Queue

Dois padrões fundamentais que parecem iguais mas têm comportamentos muito diferentes:

- **Pub/Sub:** publisher emite, todos os subscribers ativos recebem. Se ninguém está ouvindo, a mensagem some.
- **Message Queue:** mensagem fica na fila até alguém consumir. Garante entrega mesmo offline.

O eden-core hoje é **Pub/Sub puro**. Entender a diferença vai te dizer se você vai precisar de persistência de mensagens no futuro.

---

## 4. Rooms / Channels / Topics

Três nomes para o mesmo conceito em contextos diferentes:

- **Room** (Socket.IO, chat apps) — grupo dinâmico de conexões
- **Channel** (Slack, Phoenix) — mesmo conceito, nome diferente
- **Topic** (Kafka, NATS) — partição lógica de mensagens

A diferença importante: em algumas implementações, `room` é sobre **quem recebe**. Em outras, é sobre **o tipo de mensagem**. Você precisa decidir o que `room` significa no Eden.

---

## 5. Idempotência

Um conceito que aparece tanto no sender quanto no receiver:

- **Idempotent receiver:** processar a mesma mensagem N vezes tem o mesmo efeito que processar uma vez
- **Idempotent sender:** reenviar a mesma mensagem não cria efeitos colaterais duplos

O seen-set (deduplicator) do eden-core torna o receiver idempotente. Mas o sender também precisa ser idempotente? Depende do que "emitir" significa no contexto do consumidor.

---

## 6. Backpressure

O que acontece quando o receiver processa mais lento do que o sender emite?

- Sem backpressure: fila cresce, memória explode, sistema cai
- Com backpressure: o sender desacelera ou bloqueia

O eden-core hoje não tem backpressure. Isso é ok para começar, mas é algo que vai aparecer em sistemas com volume alto.

---

## 7. Event Envelope vs. Event Schema

Dois níveis de contrato que são frequentemente confundidos:

- **Envelope:** a estrutura que carrega a mensagem (`id`, `type`, `timestamp`, `room`, `payload`)
- **Schema:** a estrutura interna do `payload` (ex: `{ userId: string, email: string }`)

O eden-core define o envelope. Quem define os schemas dos payloads? O consumidor? Existe um registry central? Isso impacta como projetos diferentes vão conversar entre si.

---

## 8. Protocol Versioning

O envelope tem um campo `version`. Por quê isso importa:

- Versões diferentes do protocolo podem coexistir na rede
- Como um receiver sabe se consegue processar uma mensagem de uma versão mais nova?
- **Estratégias:** semver, negociação de versão no handshake, campos opcionais para backwards compat

---

## 9. Heartbeat / Ping-Pong

WebSocket tem um mecanismo nativo de keepalive (ping/pong a nível de protocolo). Mas aplicações geralmente implementam o próprio heartbeat em nível de aplicação.

- Por que? Para detectar conexões "zombie" (conectada no TCP mas sem resposta)
- Como funciona: sender envia `ping` periódico, receiver responde `pong`. Silêncio = conexão morta.

O eden-core vai precisar disso? Depende de quem gerencia a conexão WS.

---

## 10. Fanout

Quando um evento precisa ser entregue para múltiplos destinos simultaneamente:

- Broadcast global = fanout para todos
- Room = fanout para o grupo
- **Selective fanout:** filtros por atributo do subscriber (ex: "apenas usuários admin")

O eden-core hoje tem broadcast global e room. Selective fanout é o próximo nível — vale entender antes de decidir se vai existir.

---

## Leituras recomendadas

- [Enterprise Integration Patterns](https://www.enterpriseintegrationpatterns.com/) — patterns de mensageria (pesado, mas é a referência)
- Documentação do NATS.io — exemplo real de um message broker simples e bem projetado
- Documentação do Phoenix Channels — exemplo de rooms bem implementado em Elixir
- "Designing Data-Intensive Applications" (Kleppmann) — capítulo de streams e mensageria

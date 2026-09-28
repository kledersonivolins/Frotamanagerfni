# Bot de agendamento via WhatsApp (Evolution API)

## Contexto

O tenant `oficinafni` (site `industriafni.netlify.app`) já tem um link público de
agendamento externo (`?agendamento=1&tenant=oficinafni`) que coleta nome, contato,
empresa, veículo, tipo de manutenção, descrição e horário, e chama
`agendamento_solicitar` — isso já vira Pré-OS automática e avisa o mecânico em
tempo real (ver `supabase/migrations/20260921120000_vagas_progressivas_e_realtime_agendamentos.sql`
e o handler `_renderAgendamentoExterno` em `index.html`).

O objetivo agora é oferecer o mesmo fluxo por conversa no WhatsApp da oficina,
via Evolution API (instância própria, não-oficial, já em produção), em vez de o
cliente preencher o formulário web. Duas diferenças em relação ao link:

1. A placa é digitada como texto livre (formatos variados: `AAA-0000`,
   `AAA0000`, Mercosul), então o bot precisa normalizar e casar com a frota
   cadastrada da empresa escolhida.
2. Quando não há vaga, em vez de travar o cliente, o pedido entra numa lista de
   espera e é notificado automaticamente quando abrir horário.

Escopo: só o tenant `oficinafni` por enquanto. Sem lookup multi-tenant por
número de WhatsApp — fica fixo no código/config desta função.

## Arquitetura

```
Cliente (WhatsApp) ──► Evolution API (instância existente) ──► webhook
                                                                   │
                                                                   ▼
                                        Supabase Edge Function `whatsapp-agendamento`
                                                                   │
                                              ┌────────────────────┼─────────────────────┐
                                              ▼                    ▼                      ▼
                                    tabela whatsapp_conversas   RPCs agendamento_*   Evolution API
                                    (estado da conversa)        (mesmas do link)     (enviar resposta)
```

A Edge Function é só um front-end conversacional: toda regra de negócio
(disponibilidade, limite de veículos, geração de Pré-OS, fila de mecânicos)
continua nas RPCs/trigger já existentes. Nenhuma dessas RPCs é alterada.

Um segundo componente, a **checagem de lista de espera**, roda como Supabase
Scheduled Function separada, chamando as mesmas RPCs de ocupação e a Evolution
API para notificar.

## Fluxo da conversa

Estado guardado por telefone em `whatsapp_conversas.etapa` (máquina de estados
simples, uma pergunta por mensagem recebida):

1. `inicio` → bot pergunta o nome do solicitante.
2. `aguardando_empresa` → lista as empresas do tenant (`agendamento_listar_empresas`),
   numeradas; cliente responde com o número da lista.
3. `aguardando_placa` → pede a placa. Normaliza (`toUpperCase()`, remove espaço
   e hífen — mesma regra de `validarPlaca` em `index.html`) e busca em
   `agendamento_listar_veiculos` filtrado pela empresa escolhida.
   - Achou → segue.
   - Não achou → informa e pede de novo (contador de tentativas na sessão).
   - 3 tentativas sem achar → mensagem encaminhando para atendimento humano
     ((86) 99995-9427) e encerra o fluxo automático (`etapa = encerrado_humano`).
4. `aguardando_tipo` → oferece as 4 opções numeradas: Preventiva, Corretiva,
   Revisão, Outro (mesmas do formulário web).
5. `aguardando_motivo` → texto livre, vira a descrição do serviço.
6. `aguardando_dia` → lista os dias com vaga do mês atual e do seguinte
   (`agendamento_ocupacao_mes`), cliente escolhe pelo número ou pela data.
7. `aguardando_hora` → lista os horários livres do dia escolhido
   (`agendamento_ocupacao_dia`).
   - Sem nenhum horário livre nos próximos ~30 dias em nenhum dia → pula para
     o fluxo de lista de espera (seção abaixo) em vez de repetir a pergunta.
8. `confirmando` → mostra um resumo e pede confirmação.
9. Confirmado → chama `agendamento_solicitar` com os dados coletados. Resposta
   ao cliente replica o que o link já mostra: protocolo e status ("Confirmado —
   vaga reservada e Pré-OS gerada" ou "Aguardando autorização", conforme o
   retorno). `etapa = finalizado`.

Qualquer erro inesperado de RPC (rede, RPC retornando `error`) é reportado ao
cliente como "não consegui processar agora, tente novamente em instantes ou
fale com (86) 99995-9427" — nunca trava a conversa sem saída.

## Lista de espera

- Quando o passo 7 não encontra nenhum horário livre, o pedido é salvo com
  `status = 'lista_espera'` na própria tabela `agendamentos_externos`
  (reaproveitada; coluna `status` já é texto livre, sem `CHECK` constraint —
  confirmado nas migrations existentes). Os dados coletados até ali (nome,
  contato, empresa, veículo, tipo, descrição) vão junto.
- `lista_espera` não conta como ocupação: as funções `agendamento_ocupacao_dia`
  e `agendamento_ocupacao_mes` já só somam `status in ('pendente','autorizado')`,
  então nenhuma mudança nelas é necessária.
- Uma Supabase Scheduled Function (`whatsapp-lista-espera`, a cada 15–30 min):
  1. Lê os registros `status = 'lista_espera'` do tenant.
  2. Para cada um, roda `agendamento_ocupacao_mes`/`agendamento_ocupacao_dia` a
     partir de hoje procurando o primeiro horário livre.
  3. Achou → manda WhatsApp via Evolution API oferecendo o horário e pedindo
     confirmação ("responda SIM para garantir a vaga às HH:MM do dia DD/MM").
     Marca o registro como `aguardando_confirmacao_espera` com o horário
     ofertado e um prazo (ex.: 2h) para responder.
  4. Cliente responde SIM (tratado no mesmo webhook `whatsapp-agendamento`,
     olhando se o telefone tem um registro em `aguardando_confirmacao_espera`)
     → reconfere a vaga na hora (evita corrida entre dois clientes) e chama
     `agendamento_solicitar`; se a vaga já foi tomada, informa e volta pra
     lista de espera.
  5. Prazo vence sem resposta → volta para `lista_espera` e o job tenta o
     próximo horário livre na próxima rodada.

## Dados novos

- **Tabela `whatsapp_conversas`**: `tenant text`, `telefone text` (chave,
  normalizado só dígitos), `etapa text`, `dados jsonb` (nome, empresa_id,
  veiculo_id, placa_tentativas, tipo, descricao, dia, hora escolhidos até
  agora), `criado_em timestamptz default now()`, `atualizado_em timestamptz`.
  RLS: sem acesso anon/authenticated direto — só a Edge Function via service
  role.
- **`agendamentos_externos.status`**: passa a aceitar também `'lista_espera'`
  e `'aguardando_confirmacao_espera'` (sem migration de schema necessária, é
  texto livre; só precisa os RPCs/telas que exibem status saberem rotular
  esses dois valores de forma amigável, se aparecerem em algum painel
  interno).

## Fora de escopo (YAGNI por agora)

- Suporte a outros tenants/números de WhatsApp.
- Cancelamento/reagendamento por WhatsApp (só criação de novo pedido).
- Envio de lembrete automático antes do horário agendado.
- Fila com múltiplas pessoas disputando o mesmo horário ofertado além do
  "primeiro que confirmar leva" simples descrito acima.

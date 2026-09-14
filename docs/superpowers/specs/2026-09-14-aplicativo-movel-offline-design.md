# FrotaManager Mobile Offline — Especificação de Arquitetura

Data: 14/09/2026  
Status: aprovado para planejamento  
Escopo inicial: Empréstimos e Ordens de Serviço

## 1. Objetivo

Criar um aplicativo Android profissional que funcione como extensão do FrotaManager web. O site permanece como sistema principal de administração e fonte central de dados. O aplicativo permite que funcionários executem, mesmo sem internet, os fluxos completos de Empréstimos e Ordens de Serviço conforme as permissões configuradas no site.

O aplicativo não será uma página remota encapsulada. Seus arquivos essenciais e seu banco operacional local serão instalados no aparelho. A mesma base produzirá um APK para instalação direta e um Android App Bundle (AAB) para publicação na Google Play.

## 2. Princípios

1. O Supabase é a fonte central e definitiva dos dados sincronizados.
2. O site é o painel administrativo e controla cadastros, escopos e permissões.
3. O aplicativo é local-first: toda ação do funcionário é salva primeiro no aparelho.
4. Sincronização deve ser idempotente: reenviar uma operação nunca cria duplicidade.
5. Nenhum botão ou indicador pode ser apenas visual; toda ação deve corresponder a regra e persistência reais.
6. O usuário deve entender claramente o que está sincronizado, pendente, em processamento ou em conflito.
7. A implantação será gradual e não interromperá o site atual.

## 3. Escopo da primeira versão

### 3.1 Incluído

- Login online inicial por aparelho e renovação periódica de autorização.
- Funcionamento offline por até sete dias desde a última validação online.
- Cache local das permissões, empresas, setores, veículos, motoristas e dados operacionais permitidos.
- Módulo completo de Empréstimos.
- Módulo completo de Ordens de Serviço.
- Leitura de QR Code pela câmera.
- Captura e envio posterior de fotos.
- Fila automática de sincronização, tratamento de conflitos e auditoria.
- Interface adaptada a celular e tablet.
- APK assinado para instalação direta.
- AAB assinado e pronto para o fluxo de testes/publicação da Google Play.
- Mudanças mínimas no site para administrar permissões móveis e exibir o estado de sincronização quando necessário.

### 3.2 Fora do escopo inicial

- Migração dos demais módulos do FrotaManager para o aplicativo.
- Reescrita completa do site administrativo.
- Operação em iPhone/iPad.
- Sincronização em segundo plano garantida quando o Android encerrar totalmente o aplicativo; ao reabrir ou recuperar conectividade com o aplicativo ativo, a sincronização é automática.
- Reserva definitiva de veículo sem validação do servidor.
- Biometria, notificações push e rastreamento contínuo de localização. Esses recursos poderão ser adicionados depois sem trocar a arquitetura.

## 4. Arquitetura

### 4.1 Componentes

1. **Site FrotaManager existente**
   - Continua administrando usuários, empresas, setores, veículos, motoristas, módulos, funções e permissões.
   - Continua oferecendo cadastros, configurações, dashboards e relatórios.
   - Compartilha o mesmo modelo de autorização usado pelo aplicativo.

2. **FrotaManager Mobile**
   - Nova aplicação React + TypeScript + Vite empacotada com Capacitor.
   - Possui navegação móvel própria e apenas os dois módulos do escopo inicial.
   - Usa SQLite nativo no Android para dados operacionais, rascunhos e fila de saída.
   - Protege segredos de sessão e chave do banco local com o Android Keystore.
   - Usa plugins nativos para câmera, QR Code, conectividade e ciclo de vida do aplicativo.

3. **Camada de sincronização**
   - Um serviço no aplicativo grava todas as mutações na base local e na fila `outbox`.
   - Uma Supabase Edge Function autenticada recebe lotes de operações.
   - A função chama rotinas transacionais no Postgres para validar permissão, versão e regra de negócio.
   - Cada retorno classifica a operação como aceita, repetida, rejeitada ou em conflito.

4. **Supabase**
   - Supabase Auth autentica os mesmos usuários do site.
   - Postgres permanece como banco central.
   - RLS separa dados por tenant, empresa, setor e usuário.
   - Storage recebe fotos somente após existir o registro principal correspondente.
   - Auditoria mantém ações do site e do aplicativo numa trilha única.

### 4.2 Organização do repositório

- O `index.html` atual continua responsável pelo site enquanto a migração é incremental.
- O aplicativo será criado na pasta isolada `apps/mobile`.
- Contratos de dados, estados e permissões usados pelo aplicativo ficarão em unidades pequenas e testáveis.
- Migrações SQL, testes de RLS e funções de sincronização ficarão sob `supabase/` e serão versionados no Git.
- Nenhuma regra crítica existirá apenas na interface; regras sensíveis serão repetidas e impostas no servidor.

## 5. Autenticação e autorização

1. O primeiro login em cada aparelho exige internet.
2. Após o login, o aplicativo baixa o perfil efetivo e o escopo permitido.
3. O aplicativo armazena localmente apenas o necessário para trabalhar offline.
4. A autorização local vence sete dias após a última validação bem-sucedida.
5. Ao vencer, consultas locais poderão ser exibidas em modo somente leitura, mas novas operações ficarão bloqueadas até reconectar.
6. Um usuário desativado no site perde o acesso assim que o aparelho volta a validar a sessão.
7. Permissões em cache controlam a interface offline, mas nunca substituem a validação do servidor na sincronização.
8. Dados de autorização não usarão `user_metadata` editável. A decisão efetiva virá das tabelas administrativas protegidas pelo servidor.
9. O aplicativo usará somente chave pública/publicável. Chaves `service_role` e segredos permanecerão no servidor.

## 6. Modelo local

O banco SQLite terá quatro grupos:

1. **Referências sincronizadas**: perfil, permissões, empresas, setores, veículos, motoristas, listas e configurações dos formulários.
2. **Dados operacionais**: empréstimos, checklists, ordens, etapas, itens, apontamentos, leituras e histórico necessário ao usuário.
3. **Rascunhos e anexos**: formulários incompletos, fotos locais e metadados de envio.
4. **Controle de sincronização**: cursor de leitura, `outbox`, confirmações, conflitos, tentativas e último horário de validação.

Cada registro criado no aparelho terá UUID estável. Cada operação terá outro UUID independente, garantindo que criação, atualização e reenvio possam ser identificados sem ambiguidade.

## 7. Protocolo de sincronização

### 7.1 Escrita local

- A ação é validada com as regras disponíveis no aparelho.
- A transação local altera o registro e insere a operação na `outbox` atomicamente.
- A interface reflete a mudança imediatamente e exibe o estado `Pendente`.
- Fechar ou reiniciar o aplicativo não perde a fila.

### 7.2 Envio

- Ao detectar conexão, o aplicativo primeiro renova a sessão.
- Em seguida envia operações na ordem de dependência, em lotes pequenos.
- O servidor identifica cada operação por `tenant + operation_id`.
- Uma operação já aceita retorna a confirmação anterior sem executar novamente.
- Dados principais são confirmados antes do envio dos anexos.

### 7.3 Recebimento

- Depois das escritas, o aplicativo solicita alterações posteriores ao seu cursor de sincronização.
- Alterações, exclusões lógicas e novas permissões são aplicadas numa transação local.
- O cursor só avança se todo o lote local for aplicado.
- Uma sincronização completa controlada estará disponível para recuperação, sem apagar operações locais pendentes.

### 7.4 Conflitos

- Eventos aditivos, como fotos, leituras e apontamentos, são unidos por UUID.
- Transições de status são validadas por uma máquina de estados no servidor.
- Edição concorrente usa versão do registro; o servidor não sobrescreve silenciosamente uma versão mais recente.
- Conflitos preservam o conteúdo local e exibem ação de correção ao usuário.
- Reservas criadas offline ficam `Aguardando confirmação de disponibilidade`.
- O servidor confirma a reserva apenas se não houver sobreposição real de intervalos.
- Em disputa, a primeira operação válida confirmada pelo servidor vence; a outra solicitação permanece disponível para troca de veículo ou período.

## 8. Modelo central e auditoria

As migrações serão aditivas e compatíveis com o site. Elas introduzirão:

- Tabela `mobile_devices` para aparelhos autorizados.
- Tabela `mobile_operations` para operações de sincronização, com restrição única de idempotência.
- Tabela `mobile_audit_events` para eventos móveis; o site exibirá esses eventos junto da auditoria existente.
- Tabela `mobile_attachments` para metadados e estado de envio dos anexos.
- Campos de origem, versão, datas de alteração e exclusão lógica nas entidades móveis.
- Vínculos de anexos com a entidade principal.
- Funções transacionais para reserva, aprovação, liberação, devolução e mudanças de estado de OS.
- Índices para tenant, empresa, setor, status, período e cursor de sincronização.

Antes das migrações, será feito inventário do esquema real para preservar IDs legados e evitar conversões destrutivas. Quando uma tabela usar ID numérico legado, o UUID móvel será armazenado numa coluna única separada, sem trocar a chave primária já consumida pelo site.

Cada evento de auditoria registrará usuário, aparelho, origem, horário informado pelo dispositivo, horário confirmado pelo servidor, entidade, ação, versão e resultado da sincronização.

## 9. Empréstimos

### 9.1 Funcionalidades

- Consultar solicitações, histórico recente, agenda e disponibilidade sincronizada.
- Criar solicitação com veículo, motorista, período, destino, finalidade e observações.
- Aprovar ou reprovar quando a função e o setor permitirem.
- Registrar responsável, cargo, data e hora da autorização.
- Executar checklist de saída e retorno.
- Registrar KM, combustível, avarias, observações, fotos, horários e assinatura quando configurada.
- Liberar, iniciar utilização, devolver, cancelar ou concluir conforme a permissão.

### 9.2 Estados

Solicitado, aguardando sincronização, aguardando confirmação de disponibilidade, aprovado, reprovado, liberado, em uso, devolução pendente, concluído e cancelado.

O solicitante não recebe ações de aprovação. Ações e listas respeitam tenant, empresa, setor, veículos e motoristas liberados no site. A sobreposição continuará usando intervalo estrito, permitindo reservas consecutivas cujo fim e início sejam exatamente iguais.

## 10. Ordens de Serviço

### 10.1 Funcionalidades

- Consultar ordens atribuídas ao usuário, equipe, setor ou empresa permitida.
- Abrir OS quando autorizado.
- Localizar veículo/equipamento e OS por QR Code.
- Iniciar, pausar, retomar e concluir execução.
- Registrar etapas, itens, peças, materiais, leituras, observações, fotos, horários e responsáveis.
- Exibir progresso calculado a partir das etapas reais.
- Consultar histórico recente disponível localmente.
- Preservar vínculo obrigatório entre custo, OS e equipamento.

### 10.2 Estados

Pré-OS, aberta, atribuída, em andamento, pausada, aguardando peça/terceiro, concluída, cancelada e reaberta. A matriz de transições será única e validada localmente e no servidor.

Uma OS não poderá ser concluída sem equipamento, campos obrigatórios e etapas exigidas. A conclusão de preventiva continuará atualizando os ciclos vinculados somente após confirmação transacional no servidor.

## 11. Interface

- Identidade visual compatível com o FrotaManager.
- Tela inicial com atividades do dia, pendências, progresso e sincronização.
- Barra inferior: Início, Empréstimos, Ordens de Serviço e Conta.
- Acesso destacado ao leitor de QR Code.
- Formulários curtos por etapas, com rascunho automático.
- Botões e áreas de toque adequados ao uso em campo.
- Busca e filtros por placa, veículo, motorista, setor, status e período.
- Estado permanente de conexão e contador de operações pendentes.
- Estados visíveis: Sincronizado, Pendente, Sincronizando e Precisa de atenção.
- Fotos comprimidas antes do envio, mantendo qualidade suficiente para evidência.
- Celular prioriza uma coluna; tablet pode apresentar lista e detalhe lado a lado.
- Retrato é o modo principal, com suporte funcional a paisagem.
- Histórico antigo é carregado online sob demanda para controlar armazenamento e desempenho.

## 12. Erros e recuperação

- Falha de rede nunca remove o registro local nem limpa a fila.
- Erros temporários usam novas tentativas com espera progressiva.
- Erros permanentes mostram causa e ação possível.
- Conflitos são separados de falhas técnicas.
- Um painel de sincronização permite inspecionar e reenviar operações.
- Anexos com falha podem ser reenviados sem repetir a operação principal.
- Logs não armazenam senha, token completo nem dados sensíveis desnecessários.
- A recuperação completa baixa novamente o escopo autorizado e reaplica a fila local ainda não confirmada.

## 13. Segurança

- RLS habilitada e testada em toda tabela exposta.
- Grants mínimos para `anon` e `authenticated`.
- Políticas específicas para leitura, inserção, atualização e exclusão lógica.
- Funções privilegiadas com `search_path` seguro e validação explícita de `auth.uid()`.
- Validação de sessão nas operações sensíveis.
- Storage protegido por tenant e vínculo da entidade.
- Criptografia local e armazenamento seguro dos materiais de sessão.
- Limpeza de dados locais após logout confirmado; operações pendentes exigem confirmação antes da limpeza.
- Proteção contra acesso cruzado entre empresas, setores e tenants por testes positivos e negativos.

## 14. Desempenho

- Sincronização incremental por cursor.
- Paginação e janelas de histórico configuradas.
- Índices alinhados aos filtros móveis.
- Envio de anexos separado e limitado por concorrência.
- Compressão de imagem antes da fila.
- Inicialização usando banco local, sem tela bloqueada aguardando rede.
- Metas iniciais: abrir a tela inicial local em até dois segundos num aparelho intermediário; resposta visual a uma gravação local em até 300 ms; nenhuma operação perdida após encerramento forçado.

## 15. Testes e critérios de aceite

### 15.1 Testes automatizados

- Regras de domínio e transições de estado.
- Fila local, reenvio e idempotência.
- Migração do banco local entre versões.
- Conflitos de edição e reserva.
- Integração da Edge Function com Postgres.
- RLS por tenant, empresa, setor, usuário e função.
- Compatibilidade do site após migrações.

### 15.2 Testes em aparelhos

- Primeiro login online e uso subsequente offline.
- Operação por sete dias e bloqueio ao expirar.
- Modo avião, queda durante envio e retorno da conexão.
- Encerramento forçado e reinício durante fila pendente.
- QR Code com item conhecido, proibido e ausente do cache.
- Fotos grandes, múltiplas e envio interrompido.
- Dois aparelhos alterando a mesma OS.
- Duas reservas offline sobrepostas.
- Desativação e alteração de permissão pelo site.
- Celulares e tablets com diferentes tamanhos de tela.

### 15.3 Aceite

- Nenhuma ação confirmada localmente é perdida após reinício.
- Reenvio não duplica dados.
- Reserva conflitante não é confirmada silenciosamente.
- Usuário nunca recebe dados fora do escopo autorizado.
- Site e aplicativo exibem o mesmo estado após sincronização concluída.
- Todas as ações exibidas funcionam e são auditadas.
- APK de teste instala e atualiza preservando o banco local.
- AAB passa pela validação técnica da Play Console.

## 16. Entrega em etapas

1. **Fundação**: estrutura mobile, login, armazenamento seguro, SQLite, permissões, conectividade e navegação.
2. **Sincronização**: esquema central, RLS, aparelhos, `outbox`, Edge Function, idempotência, auditoria e painel de estado.
3. **Empréstimos**: agenda, solicitação, aprovação, checklists, liberação, uso e devolução.
4. **Ordens de Serviço**: listas, atribuição, execução, itens, QR Code, fotos, progresso e conclusão.
5. **Integração e endurecimento**: conflitos, recuperação, desempenho, segurança e compatibilidade com o site.
6. **Distribuição interna**: APK assinado e teste controlado em aparelhos reais.
7. **Google Play**: AAB, ficha da loja, política de privacidade, declarações de dados, teste interno/fechado e produção conforme os requisitos vigentes da conta.

Cada etapa terá testes próprios e somente avança quando a anterior estiver estável. O site continuará operacional durante toda a construção.

## 17. Publicação e atualização

- O pacote Android usará o identificador definitivo `br.com.ferronorte.frotamanager` e o nome visível `FrotaManager`.
- A chave de assinatura e a chave de upload serão guardadas fora do repositório.
- APK direto e AAB usarão a mesma versão de código e configuração de produção.
- A primeira distribuição será interna; depois seguirá para teste fechado e produção.
- Atualizações do aplicativo serão versionadas. Mudanças de banco local terão migrações compatíveis para preservar dados pendentes.
- A publicação na Google Play dependerá de acesso à conta do desenvolvedor, aceite das declarações exigidas e materiais da ficha da loja.

## 18. Riscos controlados

- **Celular offline com permissões revogadas**: limite de sete dias e validação obrigatória na sincronização.
- **Reservas concorrentes**: estado provisório offline e confirmação exclusiva no servidor.
- **Esquema legado heterogêneo**: migrações aditivas e UUID móvel separado quando necessário.
- **Arquivo web monolítico**: aplicativo isolado; alterações no site limitadas à integração administrativa.
- **Fotos consumindo armazenamento**: compressão, limites e limpeza somente após confirmação do servidor.
- **Android interrompendo tarefas em segundo plano**: sincronização ao recuperar conexão com o app ativo e sempre ao abrir/retomar o aplicativo.

## 19. Referências técnicas

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Sessions: https://supabase.com/docs/guides/auth/sessions
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Data Security: https://supabase.com/docs/guides/database/secure-data
- Google Play — testes internos: https://support.google.com/googleplay/android-developer/answer/9845334
- Google Play — APK/AAB para compartilhamento interno: https://support.google.com/googleplay/android-developer/answer/9844679

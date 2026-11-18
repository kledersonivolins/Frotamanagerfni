# Planos Preventivos — uma página só, por seções (design curto)

Data: 2026-11-18 · Tela: menu "Planos Preventivos" (`renderPlanos`, `index.html`) · Porte: mudança pequena (uma função de tela + CSS).

## Intenção e porquê
Klederson quer continuar vendo **um equipamento por vez**, com tudo dele junto e agrupado por classe
(óleos, filtros, operações). Hoje a tela confunde porque:
- cada classe fica numa aba separada (5 abas) e é preciso clicar para ver o equipamento inteiro;
- as colunas mudam de aba para aba (até 12 colunas, com Amostragem, Remonta, Limpeza);
- "Próximo" mostra um número absoluto (ex.: 45.200 km), sem dizer quanto falta;
- a aba "Carac. Técnicas" só repete a lista inteira.

## Objetivos
- Ver todos os itens do equipamento numa página só, em seções por classe.
- Em cada item, ver de relance: última execução, próxima, **quanto falta (ou há quanto venceu)** e situação.
- Itens mais urgentes primeiro dentro de cada seção.

## Não objetivos / anti-objetivos
- Não mudar a visão "um equipamento por vez" nem criar visão de frota inteira.
- Não mudar `calcPlanoStatus`, cadastro/edição de plano, execução, importação de ficha, nem o banco.
- Não perder dados: nenhum campo some (Amostragem, Remonta, Limpeza só mudam de lugar).
- Falha seria: o usuário ter que clicar mais do que hoje, ou deixar de achar um item.

## Abordagens consideradas
- **A. Página única com seções por classe (escolhida por Klederson).** Sem abas; seções recolhíveis.
- B. Manter abas e só limpar colunas — ainda exige clicar de aba em aba.
- C. Cartões por item com barra — ocupa muito espaço em equipamentos com 25+ itens.

## Design
1. **Topo:** seletor de equipamento, busca, botões Inserir / Registrar execução / Importar ficha (como hoje),
   faixa com KM e horas atuais, e resumo clicável `🔴 N vencidos · 🟡 N atenção · 🟢 N em dia` que filtra a lista.
2. **Seções empilhadas e recolhíveis:** Óleos e Lubrificantes · Filtros · Operações · Histórico (recolhido por padrão).
   A classificação continua a de hoje (`isFiltro`/`isLub`/restante), sem mudança de regra.
3. **Colunas iguais nas três primeiras seções:** Item (código + descrição + compartimento) · A cada · Última ·
   Próxima · **Situação** (barra de progresso + "faltam X km/h" ou "vencido há X") · Ações (editar, executar, excluir).
4. **"Ver detalhes" por linha** abre uma linha extra com: capacidade (L), peças/referência, Amostragem KM/H,
   % Remonta, Limpeza KM/H e Gatilho — tudo que hoje ocupa colunas.
5. **Ordenação:** vencidos, depois atenção, depois em dia; dentro de cada grupo, o de maior % primeiro.
6. **Remover** a aba "Carac. Técnicas" e o texto "estilo Sienge" do rodapé; manter a legenda das cores.
7. **Mobile:** seções em lista de cartões compactos (sem tabela larga).

## Decisões minhas (para conferir)
- "Ver detalhes" para Amostragem/Remonta/Limpeza (Klederson ainda não respondeu se usa no dia a dia).
- Itens só com intervalo em **meses** e `ultima_data`: `calcPlanoStatus` ignora meses (hoje aparecem sempre "OK").
  Nesta tela mostro "próxima em dd/mm/aaaa" e calculo a situação só aqui, sem alterar `calcPlanoStatus`.
  Efeito: alguns itens que hoje aparecem "OK" podem aparecer como vencidos nesta tela. Dashboard e alertas ficam como estão.
- Seções recolhidas/abertas lembradas por equipamento só durante a sessão (sem gravar no banco).

## Deixado para quem for construir
Ajustes finos de CSS, textos das legendas e o nome exato das funções auxiliares. Teste de regressão novo
(`planos-preventivos-regression.mjs`) cobrindo: agrupamento por classe, ordenação por urgência, texto "faltam/venceu há",
item só em meses, e que nenhum item do equipamento some da página.

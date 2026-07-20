# Cronos Odonto

Sistema de gestão comercial e financeira para clínicas odontológicas.

O Cronos Odonto centraliza o acompanhamento de leads, oportunidades, tratamentos e recebimentos em uma única plataforma.

© 2026 Cronos Odonto Software. Todos os direitos reservados.

Este é um software proprietário. A reprodução, distribuição, modificação ou utilização do código sem autorização é proibida.


## v425 — proteção pós-importação

- login não dispara salvamento do estado operacional;
- filas antigas com milhares de alterações acidentais são descartadas;
- autosave do navegador bloqueia alterações em massa;
- imports continuam sendo processados pelas Edge Functions/RPCs em lotes.


## v426 — hidratação sem regravação e manutenção leve

- alinha a cópia normalizada do app com a linha de base V4 sem gerar commit no login;
- impede que compatibilizações de campos antigos virem atualização em massa;
- mantém o bloqueio de segurança para operações realmente gigantes;
- troca a manutenção fixa do Hoje no Cronos por execução ociosa e orientada a mudanças, reduzindo os avisos amarelos ao trocar filtros.


## Ajuste v427

Filtros são operações somente de leitura, sem autosave. Busca usa debounce e controles de ano/mês disparam apenas uma renderização. A manutenção do Hoje no Cronos permanece ociosa e condicionada a mudança real de dados.


## v429 — botão Atualizar somente leitura

- o botão **Atualizar** não chama mais o salvamento genérico da clínica antes de buscar a nuvem;
- na persistência V4, ele apenas aguarda comandos pontuais pendentes e carrega o estado oficial;
- a atualização renderiza somente a tela ativa e não executa reparos que possam alterar dados;
- elimina o falso aviso **“Atualização em massa bloqueada”** ao atualizar manualmente.

## v428 — tarefas transacionais direcionadas
- Criar, editar, concluir, adiar e excluir tarefas usa pacotes V4 apenas da tarefa alterada.
- Renderização de tarefas não dispara salvamento.
- Fechamento do modal remove foco antes de `aria-hidden`.

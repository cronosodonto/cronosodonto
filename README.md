# Cronos Odonto — V1.40.0

Sistema de gestão para clínicas odontológicas.

O Cronos Odonto centraliza leads, pacientes, avaliações, tratamentos, prontuário, exames digitais, recebimentos e Agenda.

## Release V1.36.0 — Histórico de desmarcações
- “Desmarcar” agora pergunta se a decisão foi do paciente ou da clínica.
- A origem, o operador e a data/hora da desmarcação ficam persistidos na Agenda da clínica.
- “Exibir desmarcados” mostra o registro no horário original sem ocupar o horário: o slot volta a ficar livre para novo agendamento.
- Quando um horário possui histórico e um novo paciente, os dois registros podem aparecer no mesmo horário.
- Registros desmarcados são somente históricos na grade e não podem ser arrastados/editados como consulta ativa.
- O ícone de informação mostra solicitação, operador, data/hora e observação opcional.
- Ao abrir um histórico, “Agendar novamente” cria uma nova consulta sem apagar a desmarcação anterior.

## Base de produção V1.35.0 — 17/09/2026

Esta é a primeira versão de produção da nova Agenda, sem modo de protótipo. A Agenda usa a persistência oficial da clínica no Supabase por meio da camada de configurações do Cronos (`settings.agendaData`), sem depender de `localStorage` para consultas, bloqueios, lembretes ou documentos da Agenda.

Principais recursos incluídos nesta release:

- Agenda diária, semanal e multi-agenda por profissional.
- Duração padrão por profissional e expediente configurável da clínica.
- Bloqueio/desbloqueio em massa e encaixes fora do expediente.
- Pesquisa de pacientes e procedimentos.
- Status de consulta, confirmação, recepção, realizado, falta, desmarcação e remarcação.
- Lembretes por consulta.
- Atalhos para prontuário, anamnese, atestado, receituário, exame digital e financeiro.
- Anamnese estruturada com impressão.
- Atestado odontológico com identidade da clínica.
- Receituário odontológico estruturado com impressão.
- Recibos geral e por parcela nos recebimentos.
- Recibo geral com parcelas pagas/em aberto identificadas visualmente.
- Tipografia clínica padronizada em 12 px nos documentos principais.

## Persistência da Agenda

A Agenda é salva na base da clínica usando a mesma camada oficial de persistência já utilizada pelo Cronos. O estado é armazenado em `settings.agendaData` e sincronizado pelo `cronosPersistSettingsPatch`, que usa o repositório transacional V4 quando disponível e o fluxo cloud oficial como fallback.

Não há gravação de consultas da Agenda em `localStorage`. O navegador pode continuar usando caches técnicos do próprio Cronos em outros módulos, mas eles não são a autoridade dos dados da Agenda.

## Publicação

O pacote mantém a estrutura estática usada pelo projeto (`index.html`, `app/`, `login/`, `superadmin/`, `assets/`, `CNAME`). Pode ser publicado no mesmo fluxo atual do repositório GitHub/hosting do Cronos.

## Segurança

Este repositório contém apenas o frontend esperado pelo projeto. Chaves administrativas, service-role keys e segredos não devem ser adicionados ao GitHub.

© 2026 Cronos Odonto Software. Todos os direitos reservados.

Software proprietário. A reprodução, distribuição, modificação ou utilização do código sem autorização é proibida.


## V1.37.0 — histórico de remarcações

- **Exibir desmarcados** evoluiu para **Exibir histórico**.
- A Agenda preserva horários anteriores de consultas remarcadas, inclusive por arrastar e soltar.
- Registros históricos não ocupam horário nem entram nos KPIs.
- Modal de desmarcação corrigido para alinhar corretamente as opções Paciente/Clínica.
- Persistência da Agenda atualizada para `settings.agendaData.version = 8`, com `history[]`.

## V1.38.0 — refinamento visual do histórico da Agenda
- Linhas históricas ficaram mais discretas, com texto e marcadores suavizados.
- A tag de remarcação ganhou maior contraste e peso visual para diferenciar rapidamente histórico de consulta ativa.
- Mantida a legibilidade dos estados de desmarcação e remarcação em temas claro e escuro.


## V1.39.0 — refinamento da navegação lateral
- Removidos os atalhos laterais redundantes **Novo lead** e **Minha senha**.
- Mantidos no rodapé apenas os controles utilitários **Atualizar** e **Sair** (e retorno do modo suporte quando aplicável).
- **Hoje no Cronos** agora possui ícone SVG de calendário/relógio no menu lateral.


## Release V1.40.0 — Navegação de data da Agenda
- O rótulo **Data** passa a alinhar com o conjunto inteiro de navegação, e não apenas com o campo central.
- Seta anterior, data e seta seguinte agora formam um único controle visual integrado.
- O botão **Hoje** mantém-se separado, mas com a mesma altura e alinhamento do navegador.
- O conjunto ganhou estados de hover/foco consistentes e adaptação para telas menores.
- Nenhuma alteração na lógica, persistência, drag-and-drop ou histórico da Agenda.


## V1.41.0 — refinamento da barra da Agenda
- Campo de data mais compacto.
- Menor espaçamento visual entre **Hoje** e o seletor de visualização.
- Sem alterações funcionais.


## V1.42.0 — Agenda no Superadmin
- Agenda adicionada aos módulos comerciais controláveis por plano e por exceção de clínica.
- Agenda liberada por perfil para Master, Gerente, Secretaria, CRC e Dentista.
- Ativação, bloqueio e ocultação continuam sob autoridade do Superadmin/Billing.
- Compatibilidade automática: planos antigos sem a chave `agenda` mantêm o módulo liberado até serem salvos novamente.

## V1.43.0 — higiene de comentários
- Comentários narrativos condensados em tags funcionais.
- Nenhuma lógica executável alterada.


## V1.45.0 — Agenda em ACL e módulos
- `agenda.view` adicionada à matriz de permissões.
- Agenda liberada por padrão em todos os perfis.
- Agenda visível no global, por cargo da clínica e por usuário individual.
- Agenda continua controlável comercialmente por plano e por exceção de clínica.

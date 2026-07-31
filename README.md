# Cronos Odonto — V456

Sistema de gestão comercial e financeira para clínicas odontológicas.

O Cronos Odonto centraliza o acompanhamento de leads, oportunidades, tratamentos e recebimentos em uma única plataforma.

© 2026 Cronos Odonto Software. Todos os direitos reservados.

Este é um software proprietário. A reprodução, distribuição, modificação ou utilização do código sem autorização é proibida.



## v448 — fila em quarentena e commit único entre abas

- nenhuma fila encontrada ao abrir o Cronos é reenviada automaticamente, independentemente da versão que a criou;
- operações antigas são reconciliadas com a nuvem e, quando não confirmadas, ficam em quarentena local;
- cada commit usa uma trava exclusiva por clínica entre abas (`Web Locks`, com fallback por lease local);
- o commit nunca é repetido automaticamente: em falha de rede há somente uma leitura de reconciliação;
- o console registra aba, operação, origem e estágio de cada envio para auditoria;
- inicializações duplicadas do repositório na mesma aba são ignoradas.


## v447 — timeout cancelável e fim do reenvio fantasma

- chamadas RPC usam `AbortController`/`abortSignal` quando suportado;
- timeout local, 408, 504 e esgotamento de infraestrutura não geram segunda tentativa imediata;
- operações com resultado incerto são revertidas na interface e arquivadas localmente;
- filas antigas da V446 são reconciliadas com a nuvem, mas não são reenviadas automaticamente;
- após um timeout, o usuário precisa recarregar para conferir o estado oficial antes de repetir a ação.


## v446 — Hoje no Cronos com gravações direcionadas

- tarefas concluídas ou adiadas salvam somente a tarefa alterada e aguardam confirmação do banco;
- fluxos marcados como enviados ou encerrados atualizam somente os metadados de fluxos;
- falhas restauram o estado local anterior e não exibem sucesso falso;
- recebimentos e aniversariantes continuam usando suas rotinas específicas.


## v445 — status de agendamento direcionado

- ações **Compareceu**, **Faltou** e **Remarcou** no Hoje no Cronos salvam somente o lead alterado;
- elimina o falso aviso **“Atualização em massa bloqueada”** ao atualizar o status do agendamento;
- sucesso visual só é exibido após confirmação da persistência.

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


## v430 — configurações transacionais

- edição da mensagem de aniversariantes salva apenas `settings` via RPC V4;
- remove filas locais legadas V2 quando a persistência V4 está ativa;
- impede recriação de patches gigantes no `pagehide/beforeunload`;
- mantém tarefas e atualização manual transacionais.


## v431 — auditoria estrutural, etapa 1

- adiciona persistência direcionada para metadados e configurações;
- remove commits ao apenas abrir preferências e ficha;
- converte usuários, identidade, mensagens, branding, catálogo, fluxos configuráveis e histórico do simulador para patches específicos;
- mantém Leads, Financeiro, Prontuário clínico e ativação de fluxos para etapas separadas, com testes próprios.

> **Publicação:** a v431 é a etapa 1 da auditoria. Teste localmente os módulos de Configurações, Usuários, Fluxos (definições) e Simulador antes de substituir a versão de produção. Leads, Financeiro e Prontuário serão convertidos em etapas próprias.


## v432 — mesclagem transacional de duplicados

- Mesclar cadastros não usa mais o salvamento genérico da clínica.
- Contato principal, contato removido, leads, tarefas, pagamentos e auditoria são confirmados em uma única transação V4.
- Se a operação falhar ou houver conflito de versão, o estado local é revertido e nenhum cadastro é parcialmente mesclado.

## v433 — mesclagem atômica com cascata validada

- a mesclagem de duplicados usa um comando V4 dedicado;
- Leads unidos no mesmo mês são removidos somente dentro da transação validada;
- tarefas, pagamentos, atividades e fluxos são transferidos para o cadastro preservado;
- uma falha cancela toda a operação, sem deixar cadastros parcialmente mesclados.

## v434 — prontuário e odontograma transacionais

- marcação de dentes ausentes, cores e observações salva somente o Lead aberto;
- avaliações e itens do plano de tratamento não chamam mais o salvamento genérico da clínica;
- edições de valor e face do procedimento usam pacote V4 direcionado;
- mantém a barreira de atualização em massa para proteger os demais registros.

> **Hotfix de produção:** versões anteriores podem exibir “Atualização em massa bloqueada” ao editar a Ficha em clínicas grandes. Publique a v434 após o teste local do odontograma.



## v435 — recebimento do odontograma transacional

- gerar recebimento pela Ficha salva somente o Lead aberto e os novos lançamentos financeiros;
- deixa de chamar `saveDB` e de comparar os milhares de pacientes da clínica;
- tarefas automáticas não são mais reconstruídas em massa: somente uma nova parcela já vencida pode gerar sua tarefa direcionada;
- falha de banco restaura Ficha e Financeiro ao estado anterior, sem marcar procedimento como pago apenas na tela.

> **Hotfix de produção:** a versão online anterior pode exibir “Atualização em massa bloqueada” ao gerar recebimento pelo odontograma. Teste localmente e publique a v435 após confirmar persistência com F5.


## v438 — Mesclagem resiliente
- timeout exclusivo da RPC de mesclagem ampliado para 60 segundos;
- removido o recarregamento integral da clínica após confirmação da RPC;
- estado e versões são atualizados com o resultado transacional já devolvido pelo servidor;
- timeout extremo passa a orientar recarregamento antes de nova tentativa.



## v441 — Reparo direcionado de tarefas automáticas

- Corrige o aviso de **Atualização em massa bloqueada** que aparecia logo após o login.
- A higienização de tarefas de parcelas agora compara e salva apenas tarefas alteradas, em lotes direcionados.
- O reparo não chama mais o `saveDB` genérico nem reenvia contatos/leads da clínica.
- Preserva `createdAt` das tarefas automáticas existentes para evitar alterações falsas a cada acesso.
- Mantém o PNG de marca e todas as correções financeiras/visuais da v440 enviada pelo usuário.

## v440 — Recebimentos direcionados

- O botão **Criar cobrança** fecha o modal após a confirmação sem exibir aviso falso de alterações não salvas.
- Aprovação, baixa, desfazer baixa, transferência e exclusão financeira usam pacote direcionado ao paciente.
- Ações financeiras não tentam reenviar a clínica inteira e não devem acionar o bloqueio de atualização em massa.
- Mantém o login, redefinição hierárquica de senha, mesclagem resiliente e logo HD da v439.

## v439 — Login, senhas e mesclagem

- Novo login responsivo com identidade comercial do Cronos.
- Recuperação orientada pela hierarquia da clínica, sem promessa de e-mail.
- Masters podem redefinir senhas conforme suas permissões.
- Proteção pós-mesclagem vinculada à operação confirmada, sem janela fixa de 1,5 s.

### Ajuste visual da marca no login
- O topo esquerdo usa um único PNG transparente com o símbolo e o nome Cronos Odonto.
- O texto da marca não é mais reconstruído por HTML/CSS, preservando proporções, tipografia e gradiente oficiais.


## v442 — Login escuro fixo

- Mantém a página de acesso sempre no tema escuro da marca.
- Remove a alternância de tema somente da tela de login.
- Preserva a preferência claro/escuro dentro do sistema após o acesso.
- Mantém integralmente o reparo direcionado de tarefas da v441.


## v443 — Salvamento direcionado de Leads

- edição/criação de Lead envia apenas contatos, Leads, pagamentos, tarefas e auditorias realmente alterados pela ação;
- remove o `saveDB` genérico do botão Salvar Lead, que podia tentar comparar e reenviar milhares de entidades após exclusões/mesclagens;
- preserva o login escuro fixo da v442 e o reparo direcionado de tarefas da v441.

## v454 — login simples com isolamento por clínica

- mantém `cronosodonto.com` como porta única;
- remove o campo visível de código da clínica;
- preserva o seletor Master/Usuário interno;
- permite o mesmo nome de usuário em clínicas diferentes;
- resolve a clínica silenciosamente pela nova Edge Function `login-clinic-user`;
- só pede para escolher a clínica no caso raro de login e senha idênticos em mais de uma clínica.


## v455 — feedback correto ao salvar usuários

Corrige o alerta falso de alterações não salvas depois de uma atualização bem-sucedida e mostra o estado **Salvando...** durante a operação.
## V457 — Cores condicionais em Performance
- Acima da base: verde.
- Abaixo da base: vermelho.
- Empate: neutro.


# Cronos Odonto — correção financeira definitiva (16/07/2026)

Base recebida: `cronosodonto-desmembrado-fase0 (6).zip`.

Correções desta versão:

- Reconcilia a fila local com o estado oficial do Supabase após F5 ou perda da resposta da requisição.
- Remove automaticamente operações que já foram confirmadas no banco, evitando “Salvando...” e “alterações pendentes” fantasmas.
- Adiciona timeout e conferência no servidor antes de repetir uma mutação financeira incerta.
- Mantém o recebimento aprovado ao desfazer uma baixa; apenas a parcela volta para pendente.
- Faz a antecipação de crédito sobre uma cópia e só altera a tela após confirmação integral.
- Em caso de falha, restaura o estado anterior sem deixar parcelas pagas sem caixa correspondente.
- Corrige o dashboard para contar parcelas distintas com o mesmo paciente, valor e data.
- Mantém a prevenção de duplicidade usando a identidade real da parcela (`financialPaymentId`), não apenas valor/data/paciente.
- Bloqueia lote entre pacientes no fluxo legado V2, onde não há garantia de transação multi-lead.

Validações executadas:

- Sintaxe JavaScript dos arquivos alterados.
- Teste de resposta perdida após commit com reconciliação automática.
- Teste de duas operações já aplicadas, sendo a primeira sobrescrita pela segunda.
- Teste de cinco parcelas de R$ 700,00 antecipadas no mesmo dia: total reconhecido de R$ 3.500,00.


## Complemento v419 — recebidos iguais e antecipação

- Reconhece baixa quando o legado usa `PAGO` ou possui somente `cashDate`, além de `PAGA`/`paidAt`.
- O KPI **R$ Recebido** usa o valor bruto quitado pelo paciente na antecipação; taxa e líquido permanecem registrados separadamente.
- Registros de caixa sem `financialPaymentId` são pareados por ocorrência com as parcelas detalhadas, em vez de eliminar pagamentos só porque paciente, data e valor coincidem.
- A deduplicação frouxa fica restrita a registros realmente anônimos/legados; parcelas modernas usam identidade financeira ou ID do lançamento.


## Correção v421 — baixa revivida x tombstone antigo

- Dashboard, Performance, Recebimentos e modal agora usam a mesma regra de parcela ativa.
- Uma parcela excluída/cancelada e posteriormente recriada, baixada ou transferida com o mesmo ID volta a ser ativa quando sua mutação é mais recente que o tombstone.
- Novas baixas removem tombstones antigos do ID antes de salvar, evitando o mesmo bug em outros logins e clínicas.
- Tombstones realmente mais novos continuam excluindo a parcela.
- Auditoria disponível no console: `cronosAuditTombstonesFinanceiros()`.

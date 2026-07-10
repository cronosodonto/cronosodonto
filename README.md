# Cronos Odonto v124 — MO V2 forçado com RLS corrigido

Base: v123/v116 estável.

Correção: para os logins da Mundo Odonto, o app usa explicitamente a fonte V2 resgatada `2674f63e-36ef-4bf2-a8e8-50f317471708` para `clinic_contacts` e `clinic_leads`.

Outras clínicas continuam usando o fluxo normal de `clinic_data_sources`/RLS.

Não importar CSV pelo Superadmin. Os CSVs são backup externo de segurança.

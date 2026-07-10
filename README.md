# Cronos Odonto v127 — Mundo Odonto V2 join contatos + cache seguro

Base: v126/v116.

Correções:
- Desativa fast-resume/local cache para logins Mundo Odonto, forçando leitura real da nuvem V2.
- Mantém Mundo Odonto na chave V2 recuperada `2674f63e-36ef-4bf2-a8e8-50f317471708`.
- Reforça a ligação `clinic_leads.contact_id -> clinic_contacts.id`.
- Copia nome/telefone do contato para o lead em memória, evitando cards sem nome/telefone.
- Mantém outras clínicas no fluxo normal.
- Não importa CSV e não altera banco.

Debug no console: `window.__CRONOS_MO_V2_DEBUG__`.

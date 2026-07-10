# Cronos Odonto v125 — Mundo Odonto V2 masterId fix

Base: v124/v116 estável.

Correção principal:
- Mantém a Mundo Odonto apontada para clinic_id 2674f63e-36ef-4bf2-a8e8-50f317471708.
- Corrige a hidratação V2 para atribuir `masterId` aos contatos/leads carregados de `clinic_contacts` e `clinic_leads`.
- Isso evita que a interface filtre todos os leads como se fossem de outro master e mostre zero.
- Não importa CSV e não altera dados do Supabase.

Teste recomendado:
1. Subir conteúdo do ZIP na raiz do GitHub Pages.
2. Abrir aba anônima em /app/.
3. Login Mundo Odonto.
4. Mês = Todos.
5. Buscar Rostivan.

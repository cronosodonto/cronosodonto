
-- Setup básico para o chat da landing do Cronos Odonto.
-- Rode este arquivo no SQL Editor do Supabase antes de testar em produção.

create extension if not exists pgcrypto;

create table if not exists public.site_chat_leads (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  dentist_name text,
  clinic_name text,
  city text,
  phone text,
  interest text,
  status text not null default 'novo',
  source text default 'landing-page',
  current_step text default 'name',
  page_url text,
  last_message text,
  transcript jsonb not null default '[]'::jsonb,
  unread_admin integer not null default 0,
  unread_visitor integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_chat_leads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_chat_leads' and policyname = 'site_chat_public_all'
  ) then
    create policy site_chat_public_all
      on public.site_chat_leads
      for all
      using (true)
      with check (true);
  end if;
end $$;

create index if not exists idx_site_chat_updated_at on public.site_chat_leads(updated_at desc);
create index if not exists idx_site_chat_status on public.site_chat_leads(status);


-- Configurações públicas do chat da landing.
-- Use exatamente 1 linha com id = 'default'.
create table if not exists public.site_chat_settings (
  id text primary key default 'default',
  avatar_url text,
  whatsapp text,
  whatsapp_message text default 'Olá! Vim pelo site do Cronos Odonto e quero saber mais sobre o sistema.',
  updated_at timestamptz not null default now()
);

insert into public.site_chat_settings (id, avatar_url, whatsapp, whatsapp_message)
values ('default', 'assets/brand/cronos-symbol-2d.png', null, 'Olá! Vim pelo site do Cronos Odonto e quero saber mais sobre o sistema.')
on conflict (id) do nothing;

alter table public.site_chat_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_chat_settings' and policyname = 'site_chat_settings_public_read'
  ) then
    create policy site_chat_settings_public_read
      on public.site_chat_settings
      for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_chat_settings' and policyname = 'site_chat_settings_public_write'
  ) then
    create policy site_chat_settings_public_write
      on public.site_chat_settings
      for all
      using (true)
      with check (true);
  end if;
end $$;


-- Fluxo editável do chatbot da landing.
alter table public.site_chat_settings
  add column if not exists flow_config jsonb not null default jsonb_build_object(
    'welcome1', 'Olá! Eu sou o Cronos 👋',
    'welcome2', 'Posso te ajudar a entender se o sistema faz sentido para a sua clínica. Primeiro: qual o seu nome?',
    'askInterest', 'Prazer, Dr(a). {nome}. Como você quer seguir?',
    'askClinic', 'Perfeito. Qual o nome da sua clínica?',
    'askPhone', 'Boa. Agora me passa seu WhatsApp com DDD para a equipe te retornar.',
    'askCity', 'E de qual cidade/estado você fala?',
    'askFreeMessage', 'Se quiser, me diga rapidinho o que você quer resolver na clínica. Ou clique em “Falar com atendente” que eu já aviso a equipe pelo Superadmin.',
    'handoffMessage', 'Perfeito. Já deixei sua conversa marcada para atendimento humano no Superadmin. A equipe Cronos vai continuar daqui.',
    'attendantLabel', 'Falar com atendente',
    'quickActions', jsonb_build_array('Quero uma demonstração', 'Quero saber valores', 'Quero entender como funciona', 'Quero falar com alguém')
  );

update public.site_chat_settings
set flow_config = jsonb_build_object(
    'welcome1', 'Olá! Eu sou o Cronos 👋',
    'welcome2', 'Posso te ajudar a entender se o sistema faz sentido para a sua clínica. Primeiro: qual o seu nome?',
    'askInterest', 'Prazer, Dr(a). {nome}. Como você quer seguir?',
    'askClinic', 'Perfeito. Qual o nome da sua clínica?',
    'askPhone', 'Boa. Agora me passa seu WhatsApp com DDD para a equipe te retornar.',
    'askCity', 'E de qual cidade/estado você fala?',
    'askFreeMessage', 'Se quiser, me diga rapidinho o que você quer resolver na clínica. Ou clique em “Falar com atendente” que eu já aviso a equipe pelo Superadmin.',
    'handoffMessage', 'Perfeito. Já deixei sua conversa marcada para atendimento humano no Superadmin. A equipe Cronos vai continuar daqui.',
    'attendantLabel', 'Falar com atendente',
    'quickActions', jsonb_build_array('Quero uma demonstração', 'Quero saber valores', 'Quero entender como funciona', 'Quero falar com alguém')
  )
where id = 'default'
  and (flow_config is null or flow_config = '{}'::jsonb);


-- Configurações globais do card "Sugestão do Cronos" na tela Hoje no Cronos.
create table if not exists public.today_cronos_settings (
  id text primary key default 'default',
  suggestion_config jsonb not null default jsonb_build_object(
    'iconMode', 'mascot',
    'iconUrl', '',
    'title', 'Sugestão do Cronos',
    'message', 'Comece pelos {agendamentos_vencidos} agendamentos vencidos e pelas tarefas com WhatsApp disponível.',
    'buttonText', 'Entendi',
    'buttonAction', 'overdue'
  ),
  updated_at timestamptz not null default now()
);

insert into public.today_cronos_settings (id, suggestion_config)
values (
  'default',
  jsonb_build_object(
    'iconMode', 'mascot',
    'iconUrl', '',
    'title', 'Sugestão do Cronos',
    'message', 'Comece pelos {agendamentos_vencidos} agendamentos vencidos e pelas tarefas com WhatsApp disponível.',
    'buttonText', 'Entendi',
    'buttonAction', 'overdue'
  )
)
on conflict (id) do nothing;

alter table public.today_cronos_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'today_cronos_settings' and policyname = 'today_cronos_settings_public_all'
  ) then
    create policy today_cronos_settings_public_all
      on public.today_cronos_settings
      for all
      using (true)
      with check (true);
  end if;
end $$;

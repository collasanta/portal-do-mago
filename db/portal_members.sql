-- Portal do Mago: acesso via Kiwify (membros do Grimório do Mago).
-- Só tabelas novas no schema curso com prefixo portal_. Idempotente: pode rodar de novo.
-- Aplicar: npm run db:migrate (usa ORACULO_DATABASE_URL; roda depois de db/oraculo.sql).

create table if not exists curso.portal_members (
  email               text primary key,              -- sempre minúsculo e sem espaços
  name                text,
  status              text not null default 'active' check (status in ('active', 'inactive')),
  source              text not null default 'manual' check (source in ('kiwify', 'manual', 'csv', 'sync')),
  access_until        timestamptz,                   -- assinatura cancelada mantém acesso até o fim do período pago
  kiwify_customer_id  text,
  kiwify_order_id     text,
  kiwify_subscription_id text,
  product_id          text,
  product_name        text,
  last_event          text,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists portal_members_status_idx on curso.portal_members (status);
create index if not exists portal_members_sub_idx on curso.portal_members (kiwify_subscription_id);

create table if not exists curso.portal_login_codes (
  id          bigserial primary key,
  email       text not null,
  code_hash   text not null,                         -- HMAC-SHA256(segredo, email:código)
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used_at     timestamptz,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists portal_login_codes_email_idx on curso.portal_login_codes (email, created_at desc);

create table if not exists curso.portal_member_events (
  id              bigserial primary key,
  received_at     timestamptz not null default now(),
  source          text not null,                     -- kiwify | admin | csv | sync
  event_type      text,
  order_id        text,
  subscription_id text,
  email           text,
  product_id      text,
  result          text,                              -- applied:active | applied:inactive | ignored:<motivo> | duplicate
  dedupe_key      text unique,                       -- kiwify: order_id:webhook_event_type
  actor           text,
  payload         jsonb
);
create index if not exists portal_member_events_email_idx on curso.portal_member_events (email, received_at desc);
create index if not exists portal_member_events_received_idx on curso.portal_member_events (received_at desc);

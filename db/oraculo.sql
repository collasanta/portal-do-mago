-- Oráculo: aulas, transcrições, trechos com embedding (pgvector 384 dims, e5-small),
-- capítulos, conversas e limites de uso. Tudo vive no schema "curso". Idempotente.
-- Precisa das extensões vector e unaccent (Supabase e Neon têm as duas).
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists curso;
-- No Supabase, a API REST pública (anon/authenticated) não enxerga nada do schema curso.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema curso from anon, authenticated';
  end if;
end $$;

-- busca em português sem acento
do $$ begin
  if not exists (select 1 from pg_ts_config c join pg_namespace n on n.oid = c.cfgnamespace
                 where n.nspname = 'curso' and c.cfgname = 'pt') then
    create text search configuration curso.pt (copy = pg_catalog.portuguese);
    alter text search configuration curso.pt
      alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;
  end if;
end $$;

-- Cada curso é uma linha. O Portal usa o slug 'grimorio'.
-- kiwify_base / kiwify_club (opcionais): montam o link "abrir a aula na Kiwify" nas citações
-- (https://members.kiwify.com/<id-da-área>/<kiwify_path da aula>?club=<club>).
create table if not exists curso.courses (
  slug          text primary key,
  name          text not null,
  creator_name  text not null,
  persona_name  text not null,
  platform      text not null default 'kiwify',
  kiwify_base   text,
  kiwify_club   text,
  created_at    timestamptz not null default now()
);
insert into curso.courses (slug, name, creator_name, persona_name)
values ('grimorio', 'Grimório', 'o Mago', 'Oráculo do Grimório')
on conflict (slug) do nothing;

-- Aulas do curso: n de 1 a 999 (carregadas por cli/ingest.mjs ou pelo dump).
-- Lives gravadas no Portal entram sozinhas com n >= 1001 (módulo "Lives do Portal").
create table if not exists curso.lessons (
  n             int primary key,
  module        text not null,
  title         text not null,
  duration      real not null,
  course        text not null default 'grimorio' references curso.courses(slug),
  kiwify_path   text,
  summary       text,
  chapters_hash text,
  chapters_cost numeric(10,6),
  updated_at    timestamptz not null default now()
);

create table if not exists curso.segments (
  lesson_n int  not null references curso.lessons(n) on delete cascade,
  idx      int  not null,
  start_s  real not null,
  end_s    real not null,
  text     text not null,
  primary key (lesson_n, idx)
);

create table if not exists curso.chunks (
  id        bigserial primary key,
  lesson_n  int  not null references curso.lessons(n) on delete cascade,
  seg_from  int  not null,
  seg_to    int  not null,
  start_s   real not null,
  end_s     real not null,
  text      text not null,
  text_hash text not null,
  embedding extensions.vector(384),
  tsv       tsvector generated always as (to_tsvector('curso.pt'::regconfig, text)) stored,
  unique (lesson_n, seg_from)
);
create index if not exists chunks_tsv_idx on curso.chunks using gin (tsv);
create index if not exists chunks_emb_idx on curso.chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Capítulos por aula (cli/chapters.mjs, Claude Haiku) para perguntas amplas
create table if not exists curso.chapters (
  id          bigserial primary key,
  lesson_n    int  not null references curso.lessons(n) on delete cascade,
  idx         int  not null,
  start_s     real not null,
  end_s       real not null,
  title       text not null,
  summary     text not null,
  key_points  jsonb not null default '[]',
  tools       jsonb not null default '[]',
  search_text text not null,
  embedding   extensions.vector(384),
  tsv         tsvector generated always as (to_tsvector('curso.pt'::regconfig, search_text)) stored,
  unique (lesson_n, idx)
);
create index if not exists chapters_tsv_idx on curso.chapters using gin (tsv);
create index if not exists chapters_emb_idx on curso.chapters using hnsw (embedding extensions.vector_cosine_ops);

-- Conversas privadas por navegador (cookie de visitante assinado)
create table if not exists curso.conversations (
  id         bigserial primary key,
  visitor_id text not null,
  title      text not null,
  course     text not null default 'grimorio' references curso.courses(slug),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_visitor_idx on curso.conversations (visitor_id, updated_at desc);

create table if not exists curso.messages (
  id              bigserial primary key,
  conversation_id bigint not null references curso.conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  citations       jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on curso.messages (conversation_id, id);

-- Uso por dia, por (hash do IP, visitante): base dos limites e do disjuntor de gasto diário
create table if not exists curso.usage (
  day           date   not null,
  ip_hash       text   not null,
  visitor_id    text   not null,
  count         int    not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd      numeric(12,6) not null default 0,
  primary key (day, ip_hash, visitor_id)
);
create index if not exists usage_day_visitor_idx on curso.usage (day, visitor_id);

-- Log de toda pergunta
create table if not exists curso.questions (
  id                bigserial primary key,
  ip_hash           text not null,
  visitor_id        text not null,
  conversation_id   bigint references curso.conversations(id) on delete set null,
  question          text not null,
  search_query      text,
  route             text,
  course            text not null default 'grimorio' references curso.courses(slug),
  created_at        timestamptz not null default now(),
  prompt_tokens     int,
  completion_tokens int,
  cost_usd          numeric(10,6),
  model             text
);
create index if not exists questions_created_idx on curso.questions (created_at desc);
create index if not exists questions_ip_created_idx on curso.questions (ip_hash, created_at desc);

-- Uma resposta por vez por visitante
create table if not exists curso.inflight (
  visitor_id text primary key,
  started_at timestamptz not null default now()
);

-- Só o backend (conexão direta) acessa; nada fica exposto em APIs REST automáticas.
alter table curso.courses       enable row level security;
alter table curso.lessons       enable row level security;
alter table curso.segments      enable row level security;
alter table curso.chunks        enable row level security;
alter table curso.chapters      enable row level security;
alter table curso.conversations enable row level security;
alter table curso.messages      enable row level security;
alter table curso.usage         enable row level security;
alter table curso.questions     enable row level security;
alter table curso.inflight      enable row level security;

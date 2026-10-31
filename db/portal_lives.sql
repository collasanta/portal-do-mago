-- Liga uma live gravada no Portal (id do worker) à aula do Oráculo (curso.lessons.n >= 1001,
-- módulo "Lives do Portal"). Preenchida sozinha pela rota /api/lives/ingest. Idempotente.
create table if not exists curso.portal_lives (
  live_id    text primary key,
  lesson_n   int not null unique references curso.lessons(n) on delete cascade,
  title      text not null,
  started_at timestamptz not null,
  duration   real not null default 0,
  updated_at timestamptz not null default now()
);
alter table curso.portal_lives enable row level security; -- só o backend acessa

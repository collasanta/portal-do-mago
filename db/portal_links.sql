-- Mural de links (/links e o quadro da sala). Idempotente.
create table if not exists curso.portal_links (
  id bigint generated always as identity primary key,
  category text not null,
  title text not null,
  url text not null,
  description text not null default '',
  sort integer not null default 0,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists portal_links_cat_sort on curso.portal_links (category, sort, id);
alter table curso.portal_links enable row level security; -- só o backend acessa

import "server-only";
import { q, pool } from "@/lib/oraculo/db";

export type PortalLink = { id: number; category: string; title: string; url: string; description: string; sort: number };

export async function listLinks(): Promise<PortalLink[]> {
  const rows = await q<PortalLink>(
    `select id, category, title, url, description, sort from curso.portal_links
     order by (select min(s.id) from curso.portal_links s where s.category = portal_links.category), sort, id`,
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export type LinkInput = { category: string; title: string; url: string; description: string };

/** Validate + normalise user input; returns an error string (pt-BR) or the clean value. */
export function cleanLink(b: Record<string, unknown>): { error: string } | { value: LinkInput } {
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const category = str(b.category);
  const title = str(b.title);
  const description = str(b.description);
  let url = str(b.url);
  if (!category || category.length > 40) return { error: "Categoria obrigatória (até 40 caracteres)." };
  if (!title || title.length > 80) return { error: "Título obrigatório (até 80 caracteres)." };
  if (description.length > 200) return { error: "Descrição com até 200 caracteres." };
  if (!url || url.length > 500) return { error: "URL obrigatória." };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url.replace(/^\/+/, ""); // "site.com" -> https://site.com
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: "URL inválida." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "Só links http ou https." };
  if (u.username || u.password || !u.hostname.includes(".")) return { error: "URL inválida." };
  return { value: { category, title, url: u.toString(), description } };
}

export async function createLink(v: LinkInput, by: string) {
  const [r] = await q<{ id: string | number }>(
    `insert into curso.portal_links (category, title, url, description, sort, created_by)
     values ($1,$2,$3,$4, coalesce((select max(sort) from curso.portal_links where category=$1), -10) + 10, $5) returning id`,
    [v.category, v.title, v.url, v.description, by],
  );
  return Number(r.id);
}

export async function updateLink(id: number, v: LinkInput) {
  const cur = await q<{ category: string }>("select category from curso.portal_links where id=$1", [id]);
  if (!cur.length) return false;
  const move = cur[0].category !== v.category; // changed category: goes to the end of the new one
  await q(
    `update curso.portal_links set category=$2, title=$3, url=$4, description=$5,
       sort = case when $6::boolean then coalesce((select max(sort) from curso.portal_links where category=$2), -10) + 10 else sort end
     where id=$1`,
    [id, v.category, v.title, v.url, v.description, move],
  );
  return true;
}

export async function deleteLink(id: number) {
  const r = await pool.query("delete from curso.portal_links where id=$1", [id]);
  return (r.rowCount ?? 0) > 0;
}

/** Swap with the neighbour inside the category; renumbers the category so sorts stay distinct. */
export async function moveLink(id: number, dir: "up" | "down") {
  const cur = await q<{ category: string }>("select category from curso.portal_links where id=$1", [id]);
  if (!cur.length) return false;
  const ids = (await q<{ id: string | number }>("select id from curso.portal_links where category=$1 order by sort, id", [cur[0].category])).map((r) => Number(r.id));
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (j >= 0 && j < ids.length) {
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await pool.query(
      "update curso.portal_links p set sort = (n.ord - 1) * 10 from unnest($1::bigint[]) with ordinality as n(id, ord) where p.id = n.id",
      [ids],
    );
  }
  return true;
}

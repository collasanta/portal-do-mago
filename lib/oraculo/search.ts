import "server-only";
import { q } from "./db";
import { embedQuery as localEmbed } from "./embedder.mjs";

export type Excerpt = {
  ref: number; // número da citação [n]
  lesson: number;
  title: string;
  start: number;
  end: number;
  text: string;
  chapter?: string; // título do capítulo (citações de capítulo)
  kiwifyPath?: string | null;
  url?: string | null; // página da aula na plataforma (preenchida na rota)
  liveId?: string; // live gravada no portal (curso.portal_lives): url vira /lives/<id>?t=
  label?: string; // "Live 31/10" para lives do portal (senão "Live NN")
};

/** Vetor da consulta: e5-small local (o mesmo modelo do ingest), dentro da própria função. */
export async function embedQuery(text: string): Promise<number[]> {
  return localEmbed(text);
}

type Hit = { lesson_n: number; seg_from: number; seg_to: number; start_s: number; end_s: number; score: number };

/** Busca híbrida: pgvector (cosseno) + full-text português/unaccent, fundidos por RRF. */
/** embedding null = só full-text (ex.: falha ao carregar o modelo). */
export async function hybridSearch(question: string, limit = 12, embedding?: number[] | null, course = "grimorio"): Promise<Excerpt[]> {
  const emb = embedding === undefined ? await embedQuery(question) : embedding;
  const hits = await q<Hit>(
    `with tq as (
       select nullif(replace(plainto_tsquery('curso.pt', $2)::text, ' & ', ' | '), '')::tsquery as q
     ),
     v as (
       select c.id, row_number() over (order by c.embedding <=> $1::text::extensions.vector) as r
       from curso.chunks c join curso.lessons l on l.n = c.lesson_n and l.course = $4
       where $1::text is not null and c.embedding is not null
       order by c.embedding <=> $1::text::extensions.vector limit 40
     ),
     f as (
       select c.id, row_number() over (order by ts_rank_cd(c.tsv, tq.q) desc) as r
       from curso.chunks c join curso.lessons l on l.n = c.lesson_n and l.course = $4, tq
       where tq.q is not null and c.tsv @@ tq.q
       order by ts_rank_cd(c.tsv, tq.q) desc limit 40
     )
     select c.lesson_n, c.seg_from, c.seg_to, c.start_s, c.end_s,
            coalesce(1.0/(60+v.r), 0) + coalesce(1.0/(60+f.r), 0) as score
     from v full outer join f using (id) join curso.chunks c using (id)
     order by score desc limit $3`,
    [emb ? `[${emb.join(",")}]` : null, question, limit, course],
  );

  // junta trechos vizinhos/sobrepostos da mesma aula
  type Group = Hit & { score: number };
  const groups: Group[] = [];
  const sorted = [...hits].sort((a, b) => a.lesson_n - b.lesson_n || a.start_s - b.start_s);
  for (const h of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.lesson_n === h.lesson_n && h.seg_from <= g.seg_to + 1) {
      g.seg_to = Math.max(g.seg_to, h.seg_to);
      g.end_s = Math.max(g.end_s, h.end_s);
      g.score = Math.max(g.score, Number(h.score)) + 0.002; // pequeno bônus por consenso
    } else groups.push({ ...h, score: Number(h.score) });
  }
  groups.sort((a, b) => b.score - a.score);
  if (!groups.length) return [];

  const texts = await q<{ i: number; title: string; kiwify_path: string | null; text: string }>(
    `select g.i, l.title, l.kiwify_path, string_agg(s.text, ' ' order by s.idx) as text
     from unnest($1::int[], $2::int[], $3::int[]) with ordinality as g(lesson_n, a, b, i)
     join curso.segments s on s.lesson_n = g.lesson_n and s.idx between g.a and g.b
     join curso.lessons l on l.n = g.lesson_n
     group by g.i, l.title, l.kiwify_path order by g.i`,
    [groups.map((g) => g.lesson_n), groups.map((g) => g.seg_from), groups.map((g) => g.seg_to)],
  );
  const byI = new Map(texts.map((t) => [Number(t.i), t]));
  return groups.map((g, k) => ({
    ref: k + 1,
    lesson: g.lesson_n,
    title: byI.get(k + 1)?.title ?? "",
    start: g.start_s,
    end: g.end_s,
    text: byI.get(k + 1)?.text ?? "",
    kiwifyPath: byI.get(k + 1)?.kiwify_path ?? null,
  }));
}

type ChapterHit = { lesson_n: number; title: string; lesson_title: string; kiwify_path: string | null; start_s: number; end_s: number;
  summary: string; key_points: string[]; tools: string[]; score: number };

/** Capítulos para perguntas amplas: mesma fusão RRF, diversificada (no máximo `perLesson` por aula). */
export async function chapterSearch(question: string, embedding: number[] | null, limit = 14, perLesson = 4, course = "grimorio"): Promise<Excerpt[]> {
  const hits = await q<ChapterHit>(
    `with tq as (
       select nullif(replace(plainto_tsquery('curso.pt', $2)::text, ' & ', ' | '), '')::tsquery as q
     ),
     v as (
       select c.id, row_number() over (order by c.embedding <=> $1::text::extensions.vector) as r
       from curso.chapters c join curso.lessons l on l.n = c.lesson_n and l.course = $3
       where $1::text is not null and c.embedding is not null order by c.embedding <=> $1::text::extensions.vector limit 60
     ),
     f as (
       select c.id, row_number() over (order by ts_rank_cd(c.tsv, tq.q) desc) as r
       from curso.chapters c join curso.lessons l on l.n = c.lesson_n and l.course = $3, tq
       where tq.q is not null and c.tsv @@ tq.q
       order by ts_rank_cd(c.tsv, tq.q) desc limit 60
     )
     select c.lesson_n, c.title, l.title lesson_title, l.kiwify_path, c.start_s, c.end_s, c.summary, c.key_points, c.tools,
            coalesce(1.0/(60+v.r), 0) + coalesce(1.0/(60+f.r), 0) as score
     from v full outer join f using (id) join curso.chapters c using (id) join curso.lessons l on l.n = c.lesson_n
     order by score desc limit 60`,
    [embedding ? `[${embedding.join(",")}]` : null, question, course],
  );
  const per = new Map<number, number>();
  const picked: ChapterHit[] = [];
  for (const h of hits) {
    const n = per.get(h.lesson_n) ?? 0;
    if (n >= perLesson) continue;
    per.set(h.lesson_n, n + 1);
    picked.push(h);
    if (picked.length >= limit) break;
  }
  // ordem didática: por aula e minuto (o curso é sequencial)
  picked.sort((a, b) => a.lesson_n - b.lesson_n || a.start_s - b.start_s);
  return picked.map((h, k) => ({
    ref: k + 1,
    lesson: h.lesson_n,
    title: h.lesson_title,
    chapter: h.title,
    kiwifyPath: h.kiwify_path,
    start: h.start_s,
    end: h.end_s,
    text: `${h.summary}${h.key_points?.length ? ` Pontos: ${h.key_points.join("; ")}.` : ""}${h.tools?.length ? ` Ferramentas: ${h.tools.join(", ")}.` : ""}`,
  }));
}

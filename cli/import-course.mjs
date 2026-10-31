// Carrega o arquivo do curso (gerado por cli/export-course.mjs e entregue em privado) no banco.
// Substitui as aulas 1..999 que vierem no arquivo; não toca nas lives do Portal (n >= 1001).
// Uso: npm run course:import -- course-data/curso.jsonl.gz
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import { db } from "./env.mjs";

const file = process.argv[2] || "course-data/curso.jsonl.gz";
if (!fs.existsSync(file)) {
  console.error(`Arquivo não encontrado: ${file}. Veja HANDOFF.md (passo 5).`);
  process.exit(1);
}
const rows = { course: [], lesson: [], segment: [], chunk: [], chapter: [] };
const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const { t, ...r } = JSON.parse(line);
  rows[t]?.push(r);
}
const c = await db();
try {
  await c.query("begin");
  for (const r of rows.course)
    await c.query(
      `insert into curso.courses (slug, name, creator_name, persona_name, platform, kiwify_base, kiwify_club) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (slug) do update set name=excluded.name, creator_name=excluded.creator_name, persona_name=excluded.persona_name,
         platform=excluded.platform, kiwify_base=excluded.kiwify_base, kiwify_club=excluded.kiwify_club`,
      [r.slug, r.name, r.creator_name, r.persona_name, r.platform, r.kiwify_base, r.kiwify_club]);
  const ns = rows.lesson.map((l) => l.n);
  await c.query("delete from curso.lessons where n = any($1) and n < 1000", [ns]); // cascata: segments/chunks/chapters
  for (const l of rows.lesson)
    await c.query(
      `insert into curso.lessons (n, module, title, duration, course, kiwify_path, summary, chapters_hash, chapters_cost) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [l.n, l.module, l.title, l.duration, l.course || "grimorio", l.kiwify_path, l.summary, l.chapters_hash, l.chapters_cost]);
  for (const s of rows.segment)
    await c.query("insert into curso.segments (lesson_n, idx, start_s, end_s, text) values ($1,$2,$3,$4,$5)", [s.lesson_n, s.idx, s.start_s, s.end_s, s.text]);
  for (const k of rows.chunk)
    await c.query(
      `insert into curso.chunks (lesson_n, seg_from, seg_to, start_s, end_s, text, text_hash, embedding) values ($1,$2,$3,$4,$5,$6,$7,$8::extensions.vector)`,
      [k.lesson_n, k.seg_from, k.seg_to, k.start_s, k.end_s, k.text, k.text_hash, k.embedding]);
  for (const h of rows.chapter)
    await c.query(
      `insert into curso.chapters (lesson_n, idx, start_s, end_s, title, summary, key_points, tools, search_text, embedding) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::extensions.vector)`,
      [h.lesson_n, h.idx, h.start_s, h.end_s, h.title, h.summary, JSON.stringify(h.key_points), JSON.stringify(h.tools), h.search_text, h.embedding]);
  await c.query("commit");
  const { rows: [t] } = await c.query(
    "select (select count(*) from curso.lessons where n<1000)::int aulas, (select count(*) from curso.chunks)::int trechos, (select count(embedding) from curso.chunks)::int com_vetor, (select count(*) from curso.chapters)::int capitulos");
  console.log("ok:", JSON.stringify(t));
} catch (e) {
  await c.query("rollback");
  throw e;
} finally {
  await c.end();
}

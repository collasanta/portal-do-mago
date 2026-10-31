// Exporta o conteúdo do curso (aulas 1..999: aulas, transcrição, trechos com embedding, capítulos)
// de um banco já pronto para um arquivo .jsonl.gz, que é entregue em PRIVADO e carregado com
// cli/import-course.mjs. Não exporta lives do Portal (n >= 1001), conversas, membros nem uso.
// Uso: ORACULO_DATABASE_URL=<banco de origem> node cli/export-course.mjs course-data/curso.jsonl.gz
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { db } from "./env.mjs";

const out = process.argv[2] || "course-data/curso.jsonl.gz";
fs.mkdirSync(path.dirname(out), { recursive: true });
const gz = zlib.createGzip();
gz.pipe(fs.createWriteStream(out));
const w = (o) => gz.write(JSON.stringify(o) + "\n");

const c = await db();
try {
  const [course] = (await c.query("select slug, name, creator_name, persona_name, platform, kiwify_base, kiwify_club from curso.courses where slug='grimorio'")).rows;
  if (course) w({ t: "course", ...course });
  const counts = {};
  const tables = {
    lesson: "select n, module, title, duration, course, kiwify_path, summary, chapters_hash, chapters_cost from curso.lessons where n < 1000 order by n",
    segment: "select lesson_n, idx, start_s, end_s, text from curso.segments where lesson_n < 1000 order by lesson_n, idx",
    chunk: "select lesson_n, seg_from, seg_to, start_s, end_s, text, text_hash, embedding::text as embedding from curso.chunks where lesson_n < 1000 order by lesson_n, seg_from",
    chapter: "select lesson_n, idx, start_s, end_s, title, summary, key_points, tools, search_text, embedding::text as embedding from curso.chapters where lesson_n < 1000 order by lesson_n, idx",
  };
  for (const [t, sql] of Object.entries(tables)) {
    const { rows } = await c.query(sql);
    for (const r of rows) w({ t, ...r });
    counts[t] = rows.length;
  }
  console.log("exportado:", JSON.stringify(counts), "->", out);
} finally {
  await c.end();
  gz.end();
}

// Lê course-data/lessons.tsv + course-data/transcripts/NN.json e faz upsert em curso.lessons/segments/chunks,
// com embeddings locais (e5-small, sem API). Idempotente: só gera vetor para trecho novo, alterado ou sem vetor.
// Uso: npm run course:ingest [-- 01 02 ...]
//
// course-data/lessons.tsv (uma aula por linha, separado por TAB, sem cabeçalho):
//   NN <TAB> módulo <TAB> título <TAB> duração em segundos [<TAB> kiwify_path opcional]
//   ex.: 01	Nichos e Modelagem	Live 1 - Minerando nichos	8474.8
// course-data/transcripts/NN.json: {"segments":[{"start":0.0,"end":4.2,"text":"..."}, ...]}
//   (saída do Whisper; cli/transcribe.mjs gera nesse formato a partir do áudio)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, ROOT } from "./env.mjs";

const DATA = path.join(ROOT, "course-data");

const TARGET = 75; // segundos por janela
const MAX = 95;
const OVERLAP = 15;

const HALLUCINATIONS = [
  /^se inscrev[ae] no canal\.?$/i,
  /legendas? pela comunidade amara/i,
  /^obrigad[oa] por assistir/i,
  /^(\.\.\.|…)$/,
  /^tchau[.!]?$/i,
  /^legenda(do|s)? por/i,
];

function cleanSegments(raw) {
  const out = [];
  const stats = { dropped: 0, collapsed: 0, loops: 0 };
  for (const s of raw) {
    let text = (s.text || "").trim();
    if (!text) { stats.dropped++; continue; }
    const dur = s.end - s.start;
    if (HALLUCINATIONS.some((r) => r.test(text)) && (dur > 8 || text.length < 30)) { stats.dropped++; continue; }
    // laço de repetição dentro do segmento: a mesma palavra/frase repetida muitas vezes
    const words = text.split(/\s+/);
    if (words.length >= 12) {
      const uniq = new Set(words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
      if (uniq.size / words.length < 0.2) {
        stats.loops++;
        text = [...uniq].slice(0, 12).join(" ") + " […]";
      }
    }
    const prev = out[out.length - 1];
    if (prev && prev.text === text) { prev.end = s.end; stats.collapsed++; continue; }
    out.push({ start: s.start, end: s.end, text });
  }
  return { segs: out, stats };
}

function chunk(segs) {
  const chunks = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i].start;
    let j = i;
    while (j + 1 < segs.length && segs[j].end - start < TARGET && segs[j + 1].end - start <= MAX) j++;
    chunks.push({
      seg_from: i, seg_to: j, start_s: start, end_s: segs[j].end,
      text: segs.slice(i, j + 1).map((s) => s.text).join(" "),
    });
    if (j + 1 >= segs.length) break;
    let k = i + 1;
    while (k <= j && segs[k].start < segs[j].end - OVERLAP) k++;
    i = Math.max(i + 1, Math.min(k, j + 1));
  }
  return chunks;
}

import { embedPassages } from "../lib/oraculo/embedder.mjs";

const lessons = fs.readFileSync(path.join(DATA, "lessons.tsv"), "utf8").trim().split("\n")
  .map((l) => l.replace(/\r$/, "").split("\t"))
  .map(([n, module, title, dur, kpath]) => ({ n: +n, nn: n, module, title, duration: +dur, kiwify_path: kpath || null }));
if (lessons.some((L) => !(L.n >= 1 && L.n <= 999) || !L.title || !(L.duration > 0)))
  throw new Error("lessons.tsv inválido: n entre 1 e 999, título e duração (segundos) obrigatórios.");
const only = process.argv.slice(2);
const c = await db();
const report = [];

for (const L of lessons) {
  await c.query(
    `insert into curso.lessons (n, module, title, duration, course, kiwify_path) values ($1,$2,$3,$4,'grimorio',$5)
     on conflict (n) do update set module=excluded.module, title=excluded.title, duration=excluded.duration,
       kiwify_path=coalesce(excluded.kiwify_path, curso.lessons.kiwify_path), updated_at=now()`,
    [L.n, L.module, L.title, L.duration, L.kiwify_path]);
  if (only.length && !only.includes(L.nn)) continue;
  const f = path.join(DATA, "transcripts", `${L.nn}.json`);
  if (!fs.existsSync(f)) { console.log(`${L.nn}: sem transcript, pulando`); continue; }
  const { segs, stats } = cleanSegments(JSON.parse(fs.readFileSync(f, "utf8")).segments);
  const chunks = chunk(segs);

  await c.query("begin");
  await c.query("delete from curso.segments where lesson_n=$1", [L.n]);
  for (let s = 0; s < segs.length; s += 500) {
    const part = segs.slice(s, s + 500);
    const vals = [], params = [];
    part.forEach((x, k) => {
      const b = params.length;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      params.push(L.n, s + k, x.start, x.end, x.text);
    });
    await c.query(`insert into curso.segments (lesson_n, idx, start_s, end_s, text) values ${vals.join(",")}`, params);
  }
  await c.query("commit");

  const existing = new Map((await c.query(
    "select seg_from, text_hash, embedding is not null as has_emb from curso.chunks where lesson_n=$1", [L.n]))
    .rows.map((r) => [r.seg_from, r]));
  for (const ch of chunks) ch.text_hash = crypto.createHash("sha1").update(`${ch.start_s}|${ch.text}`).digest("hex");
  const keep = new Set(chunks.map((ch) => ch.seg_from));
  const stale = [...existing.keys()].filter((k) => !keep.has(k));
  if (stale.length) await c.query("delete from curso.chunks where lesson_n=$1 and seg_from = any($2)", [L.n, stale]);
  const todo = chunks.filter((ch) => { const e = existing.get(ch.seg_from); return !e || e.text_hash !== ch.text_hash || !e.has_emb; });

  // 1) grava o texto já (full-text funciona na hora); embedding só é zerado se o texto mudou
  for (const ch of todo) {
    await c.query(
      `insert into curso.chunks (lesson_n, seg_from, seg_to, start_s, end_s, text, text_hash)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (lesson_n, seg_from) do update set seg_to=excluded.seg_to, start_s=excluded.start_s, end_s=excluded.end_s,
         text=excluded.text, text_hash=excluded.text_hash,
         embedding = case when curso.chunks.text_hash = excluded.text_hash then curso.chunks.embedding end`,
      [L.n, ch.seg_from, ch.seg_to, ch.start_s, ch.end_s, ch.text, ch.text_hash]);
  }
  // 2) embeddings locais (e5-small no Mac, sem API nem cota)
  let embedded = 0;
  if (todo.length) {
    await embedPassages(todo.map((ch) => `Live ${L.nn} – ${L.title}\n${ch.text}`), 16, async (i, vecs) => {
      for (let k = 0; k < vecs.length; k++) {
        await c.query("update curso.chunks set embedding=$3::extensions.vector where lesson_n=$1 and seg_from=$2",
          [L.n, todo[i + k].seg_from, `[${vecs[k].join(",")}]`]);
      }
      embedded += vecs.length;
      process.stdout.write(`  ${L.nn}: ${embedded}/${todo.length} embeddings\r`);
    });
  }
  const line = `${L.nn}: ${segs.length} segs, ${chunks.length} chunks (${embedded}/${todo.length} embedded), ` +
    `dropped ${stats.dropped}, collapsed ${stats.collapsed}, loops ${stats.loops}`;
  console.log(line.padEnd(90));
  report.push(line);
}
const tot = await c.query("select count(*)::int n, count(embedding)::int e from curso.chunks");
console.log(`total chunks ${tot.rows[0].n}, with embedding ${tot.rows[0].e}`);
await c.end();

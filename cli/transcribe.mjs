// Transcreve o áudio/vídeo das aulas com o Whisper da Cloudflare (Workers AI, mesmo modelo das lives do Portal)
// e grava course-data/transcripts/NN.json no formato que o cli/ingest.mjs lê.
// Precisa: ffmpeg instalado, CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN (permissão "Workers AI: Read/Edit") no .env.local.
// Custo: ~US$ 0,03 por hora de áudio (preço do whisper-large-v3-turbo na Cloudflare).
// Uso: npm run course:transcribe -- course-data/audio/01.mp4 [course-data/audio/02.m4a ...]
//   O nome do arquivo (01, 02, ...) vira o NN da aula e tem que bater com a 1ª coluna do lessons.tsv.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./env.mjs";

const MODEL = "@cf/openai/whisper-large-v3-turbo";
const PIECE_S = 300; // blocos de 5 min (limite de tamanho por chamada)
const { CLOUDFLARE_ACCOUNT_ID: ACC, CLOUDFLARE_API_TOKEN: TOKEN } = process.env;
if (!ACC || !TOKEN) {
  console.error("Faltam CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN no .env.local.");
  process.exit(1);
}
const files = process.argv.slice(2);
if (!files.length) {
  console.error("Uso: npm run course:transcribe -- course-data/audio/01.mp4 ...");
  process.exit(1);
}
const outDir = path.join(ROOT, "course-data", "transcripts");
fs.mkdirSync(outDir, { recursive: true });

async function whisper(buf) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/ai/run/${MODEL}`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ audio: buf.toString("base64"), language: "pt", task: "transcribe", vad_filter: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(`HTTP ${r.status} ${JSON.stringify(j.errors || j).slice(0, 200)}`);
      return j.result;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 3000 * attempt));
    }
  }
}

for (const file of files) {
  const nn = path.basename(file).replace(/\.[^.]+$/, "");
  const out = path.join(outDir, `${nn}.json`);
  if (fs.existsSync(out)) { console.log(`${nn}: já existe, pulando`); continue; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transcribe-"));
  execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
    "-f", "segment", "-segment_time", String(PIECE_S), path.join(tmp, "p%04d.mp3")]);
  const pieces = fs.readdirSync(tmp).filter((f) => f.endsWith(".mp3")).sort();
  const segments = [];
  for (const [i, p] of pieces.entries()) {
    const r = await whisper(fs.readFileSync(path.join(tmp, p)));
    for (const s of r.segments || [])
      segments.push({ start: +(s.start + i * PIECE_S).toFixed(2), end: +(s.end + i * PIECE_S).toFixed(2), text: String(s.text).trim() });
    process.stdout.write(`  ${nn}: ${i + 1}/${pieces.length} blocos\r`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(out, JSON.stringify({ n: nn, segments }, null, 1));
  const dur = segments.length ? segments[segments.length - 1].end : 0;
  console.log(`${nn}: ${segments.length} segmentos, ~${(dur / 60).toFixed(0)} min -> ${path.relative(ROOT, out)}`);
}

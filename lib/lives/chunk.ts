// Same cleaning + windowing as the course ingest (curso-faceless/cli/ingest.mjs), so live chunks
// look like lesson chunks to the Oráculo search: ~75 s windows, max 95 s, 15 s overlap.
export type Seg = { start: number; end: number; text: string };
export type Chunk = { seg_from: number; seg_to: number; start_s: number; end_s: number; text: string };

const TARGET = 75;
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

export function cleanSegments(raw: Seg[]) {
  const segs: Seg[] = [];
  const stats = { dropped: 0, collapsed: 0, loops: 0 };
  for (const s of raw) {
    let text = (s.text || "").trim();
    if (!text) { stats.dropped++; continue; }
    const dur = s.end - s.start;
    if (HALLUCINATIONS.some((r) => r.test(text)) && (dur > 8 || text.length < 30)) { stats.dropped++; continue; }
    const words = text.split(/\s+/);
    if (words.length >= 12) {
      const uniq = new Set(words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")));
      if (uniq.size / words.length < 0.2) {
        stats.loops++;
        text = [...uniq].slice(0, 12).join(" ") + " […]";
      }
    }
    const prev = segs[segs.length - 1];
    if (prev && prev.text === text) { prev.end = s.end; stats.collapsed++; continue; }
    segs.push({ start: s.start, end: s.end, text });
  }
  return { segs, stats };
}

export function chunkSegments(segs: Seg[]): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i].start;
    let j = i;
    while (j + 1 < segs.length && segs[j].end - start < TARGET && segs[j + 1].end - start <= MAX) j++;
    chunks.push({ seg_from: i, seg_to: j, start_s: start, end_s: segs[j].end, text: segs.slice(i, j + 1).map((s) => s.text).join(" ") });
    if (j + 1 >= segs.length) break;
    let k = i + 1;
    while (k <= j && segs[k].start < segs[j].end - OVERLAP) k++;
    i = Math.max(i + 1, Math.min(k, j + 1));
  }
  return chunks;
}

/** "Live 31/10" in São Paulo time (what students call them). */
export function liveLabel(d: Date) {
  const s = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  return `Live ${s}`;
}

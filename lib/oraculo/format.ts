export function hms(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(r).padStart(2, "0");
  return `${String(h).padStart(2, "0")}:${mm}:${ss}`;
}
export const nn = (n: number) => String(n).padStart(2, "0");

/** Título curto: tira o prefixo "LIVE dd/mm/aaaa - ". */
export function shortTitle(t: string) {
  return t.replace(/^LIVE\s+\d{2}\/\d{2}\/\d{4}\s*-\s*/i, "");
}
export function liveDate(t: string) {
  return t.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] ?? null;
}

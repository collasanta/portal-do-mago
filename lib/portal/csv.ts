// CSV import of a Kiwify sales export (Vendas -> Exportar). Column names vary, so we detect them.

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') (cell += '"'), i++;
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findCol(header: string[], tests: ((h: string) => boolean)[]) {
  const h = header.map(norm);
  for (const t of tests) {
    const i = h.findIndex(t);
    if (i >= 0) return i;
  }
  return -1;
}

export type CsvColumns = { email: number; status: number; product: number; name: number };

export function detectColumns(header: string[]): CsvColumns {
  return {
    email: findCol(header, [(h) => h === "email" || h === "e mail", (h) => /e ?mail/.test(h) && /(cliente|comprador|customer|buyer)/.test(h), (h) => /e ?mail/.test(h) && !/afiliad|produtor|affiliate/.test(h)]),
    status: findCol(header, [(h) => h === "status", (h) => /status/.test(h) && !/pagamento|payment/.test(h), (h) => /status/.test(h)]),
    product: findCol(header, [(h) => h === "produto" || h === "product", (h) => /produto|product/.test(h) && !/id$/.test(h)]),
    name: findCol(header, [(h) => h === "nome" || h === "cliente" || h === "name", (h) => /(nome|name)/.test(h) && /(cliente|comprador|customer)/.test(h), (h) => /^nome|name$/.test(h)]),
  };
}

const ACTIVE = /^(paga|pago|paid|aprovad|approved|ativ|active|complete|conclu|autorizad|authorized)/;
const INACTIVE = /^(reembols|refund|estorn|chargeback|chargedback|cancel|recusad|refused|expirad|inativ|inactive|atrasad|late|vencid)/;

/** active | inactive | null (pending/unknown: skip). No status column -> active. */
export function statusOf(v: string | undefined): "active" | "inactive" | null {
  if (v === undefined) return "active";
  const s = norm(v);
  if (!s) return null;
  if (INACTIVE.test(s)) return "inactive";
  if (ACTIVE.test(s)) return "active";
  return null;
}

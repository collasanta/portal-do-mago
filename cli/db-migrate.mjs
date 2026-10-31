// Cria/atualiza todo o banco (schema "curso"): Oráculo + Portal. Idempotente: pode rodar de novo.
// Uso: npm run db:migrate   (lê ORACULO_DATABASE_URL do .env.local)
//   --seed-links  semeia o mural /links com exemplos se ele estiver vazio
import fs from "node:fs";
import path from "node:path";
import { db, ROOT } from "./env.mjs";

const FILES = ["oraculo.sql", "portal_members.sql", "portal_links.sql", "portal_lives.sql"];
const c = await db();
try {
  for (const f of FILES) {
    await c.query(fs.readFileSync(path.join(ROOT, "db", f), "utf8"));
    console.log("aplicado:", f);
  }
  if (process.argv.includes("--seed-links")) {
    const { rows } = await c.query("select count(*)::int n from curso.portal_links");
    if (rows[0].n === 0) {
      const seed = [
        ["Canal e YouTube", "YouTube Studio", "https://studio.youtube.com", "Painel do seu canal: uploads, analytics e monetização."],
        ["Canal e YouTube", "TubeBuddy", "https://www.tubebuddy.com", "Extensão de SEO, tags e testes A/B de thumbnail."],
        ["Canal e YouTube", "vidIQ", "https://vidiq.com", "Pesquisa de palavras-chave e análise de concorrentes."],
        ["Design e thumbnails", "Canva", "https://www.canva.com", "Thumbnails, capas e artes rápidas."],
        ["Design e thumbnails", "Photopea", "https://www.photopea.com", "Editor de imagens no navegador, parecido com o Photoshop."],
        ["Design e thumbnails", "Freepik", "https://www.freepik.com", "Imagens, vetores e ícones."],
        ["Áudio e vídeo", "ElevenLabs", "https://elevenlabs.io", "Narração com voz de IA."],
        ["Áudio e vídeo", "CapCut", "https://www.capcut.com", "Edição de vídeo simples e rápida."],
      ];
      let i = 0;
      for (const [cat, t, u, d] of seed)
        await c.query("insert into curso.portal_links (category,title,url,description,sort,created_by) values ($1,$2,$3,$4,$5,'seed')", [cat, t, u, d, i++ * 10]);
      console.log("links de exemplo:", seed.length);
    }
  }
  const t = await c.query("select table_name from information_schema.tables where table_schema='curso' order by 1");
  console.log("tabelas em curso:", t.rows.map((x) => x.table_name).join(", "));
  const ext = await c.query("select extname, extnamespace::regnamespace as schema from pg_extension where extname in ('vector','unaccent')");
  console.log("extensões:", ext.rows.map((r) => `${r.extname}@${r.schema}`).join(", "));
} finally {
  await c.end();
}

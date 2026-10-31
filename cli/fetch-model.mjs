// Baixa (uma vez) os arquivos do modelo de embedding para models/, numa revisão fixa.
// Roda no prebuild (Vercel). Não precisa de segredo nenhum. (Oráculo do Mago: mesma revisão do Oráculo dos Cursos.)
import fs from "node:fs";
import path from "node:path";

const MODEL = "Xenova/multilingual-e5-small";
const REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx"];
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const base = process.env.EMBED_MODELS_DIR || path.join(root, "models");
const dir = path.join(base, MODEL);
// os arquivos do modelo (~120 MB) nunca vão pro git
fs.mkdirSync(base, { recursive: true });
fs.writeFileSync(path.join(base, ".gitignore"), "*\n");

for (const f of FILES) {
  const dest = path.join(dir, f);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${f}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(dest + ".part", buf);
      fs.renameSync(dest + ".part", dest);
      console.log(`model: ${f} (${(buf.length / 1e6).toFixed(1)} MB)`);
      break;
    } catch (e) {
      if (attempt >= 4) throw new Error(`falhou baixar ${f}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// Embeddings locais (sem API, sem cota): multilingual-e5-small q8 via transformers.js/ONNX.
// O MESMO módulo roda no ingest (cli/*.mjs, no Mac) e nas consultas (função da Vercel):
// modelo, quantização, prefixos e pooling têm que ser idênticos dos dois lados.
// Os arquivos do modelo ficam em models/ (baixados por cli/fetch-model.mjs no prebuild/ingest).
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

export const MODEL = "Xenova/multilingual-e5-small";
export const REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const DTYPE = "q8"; // onnx/model_quantized.onnx (118 MB)
export const DIMS = 384;
export const MODELS_DIR = process.env.EMBED_MODELS_DIR || path.join(process.cwd(), "models");

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = MODELS_DIR + "/";
env.useBrowserCache = false;

let extractor = null;
function load() {
  extractor ??= pipeline("feature-extraction", MODEL, { dtype: DTYPE, device: "cpu" }).catch((e) => {
    extractor = null;
    throw e;
  });
  return extractor;
}

async function run(texts) {
  const ex = await load();
  const t = await ex(texts, { pooling: "mean", normalize: true });
  return t.tolist();
}

/** Consulta do aluno (prefixo "query: " do e5). */
export async function embedQuery(text) {
  return (await run([`query: ${text}`]))[0];
}

/** Trechos/capítulos (prefixo "passage: " do e5), em lotes. */
export async function embedPassages(texts, batch = 16, onBatch) {
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const vecs = await run(texts.slice(i, i + batch).map((t) => `passage: ${t}`));
    out.push(...vecs);
    if (onBatch) await onBatch(i, vecs);
  }
  return out;
}

/** Aquece o modelo (carrega a sessão ONNX) sem gerar nada útil. */
export async function warm() {
  await load();
}

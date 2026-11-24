import type { NextConfig } from "next";

// Cloudflare Worker build (npm run cf:build): swap transformers.js/ONNX for a stub (see wrangler.jsonc).
const CF = !!process.env.CF_BUILD;
const EMBEDDER_ALIAS = { "@huggingface/transformers": "./lib/cf/transformers-stub.mjs" };

const nextConfig: NextConfig = {
  ...(CF ? { turbopack: { resolveAlias: EMBEDDER_ALIAS } } : {}),
  // Cache Components/PPR hang on Workers (OpenNext has no support yet): the CF build renders dynamically.
  cacheComponents: !CF,
  partialPrefetching: !CF,

  // --- Oráculo (embeddings locais e5-small q8) ---
  // O modelo vai junto da função de perguntas, e só o binário linux-x64 do onnxruntime
  // (os de mac/windows/arm e o build web estourariam o limite de 250 MB da função).
  serverExternalPackages: CF ? ["pg"] : ["pg", "@huggingface/transformers", "onnxruntime-node"],
  outputFileTracingIncludes: CF ? {} : {
    "/api/lives/ingest": [
      "./models/**/*",
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/*",
      "./node_modules/onnxruntime-common/**/*",
    ],
    "/api/oraculo/ask": [
      "./models/**/*",
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/x64/*",
      "./node_modules/onnxruntime-common/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      "./node_modules/onnxruntime-web/**",
      "./node_modules/@img/sharp-wasm32/**",
      "./node_modules/@img/sharp-*darwin*/**",
    ],
  },
  // --- fim Oráculo ---
};

export default nextConfig;

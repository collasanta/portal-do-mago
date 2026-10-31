import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,

  // --- Oráculo (embeddings locais e5-small q8) ---
  // O modelo vai junto da função de perguntas, e só o binário linux-x64 do onnxruntime
  // (os de mac/windows/arm e o build web estourariam o limite de 250 MB da função).
  serverExternalPackages: ["pg", "@huggingface/transformers", "onnxruntime-node"],
  outputFileTracingIncludes: {
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

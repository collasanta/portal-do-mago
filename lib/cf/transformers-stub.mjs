// Stand-in for @huggingface/transformers in the Cloudflare Worker build (CF_BUILD=1): onnxruntime-node
// cannot run on Workers. embedQuery then rejects and the Oráculo falls back to full-text search.
export const env = {};
export function pipeline() {
  return Promise.reject(new Error("local embedder unavailable on Cloudflare Workers"));
}

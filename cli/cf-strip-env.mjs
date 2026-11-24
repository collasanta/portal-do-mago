// OpenNext copies .env.local into the Worker bundle; on Cloudflare the values come from Worker secrets instead.
import fs from "node:fs";
fs.writeFileSync(".open-next/cloudflare/next-env.mjs", "export const production = {};\nexport const development = {};\nexport const test = {};\n");

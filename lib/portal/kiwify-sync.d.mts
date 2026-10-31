type Env = Record<string, string | undefined>;
export function syncConfig(env: Env): { ok: boolean; missing: string[]; products: string[]; all: boolean; since: string };
export function runKiwifySync(o: {
  env: Env;
  query: (text: string, params?: unknown[]) => Promise<unknown>;
  dryRun?: boolean;
  actor?: string;
  log?: (s: string) => void;
}): Promise<{ ok: boolean; skipped?: boolean; message: string; sales?: number; emails?: number; active?: number; inactive?: number; dryRun?: boolean }>;

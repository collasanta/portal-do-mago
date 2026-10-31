import "server-only";
import { q } from "./db";

export type Course = {
  slug: string; name: string; creator_name: string; persona_name: string;
  platform: string; kiwify_base: string | null; kiwify_club: string | null;
};

const cache = new Map<string, { c: Course | null; at: number }>();

/** Curso (linha de curso.courses), com cache de 5 min. */
export async function getCourse(slug: string): Promise<Course | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 300_000) return hit.c;
  const [c] = await q<Course>(
    "select slug, name, creator_name, persona_name, platform, kiwify_base, kiwify_club from curso.courses where slug=$1", [slug]);
  cache.set(slug, { c: c ?? null, at: Date.now() });
  return c ?? null;
}

/** Página da aula na plataforma (a Kiwify não aceita minuto; é só a página da aula). */
export function lessonUrl(course: Course | null, path: string | null | undefined) {
  if (!course?.kiwify_base || !path) return null;
  return `${course.kiwify_base}/${path}${course.kiwify_club ? `?club=${course.kiwify_club}` : ""}`;
}

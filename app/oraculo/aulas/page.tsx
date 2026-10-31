import { Suspense } from "react";
import Link from "next/link";
import Header from "@/components/oraculo/Header";
import { q } from "@/lib/oraculo/db";
import { liveDate, nn, shortTitle } from "@/lib/oraculo/format";
import { getCourse, lessonUrl } from "@/lib/oraculo/course";

export const metadata = { title: "Aulas · Oráculo do Mago" };

type L = { n: number; module: string; title: string; duration: number; kiwify_path: string | null; live_id: string | null };

function dur(s: number) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

export default function AulasPage({ searchParams }: PageProps<"/oraculo/aulas">) {
  return (
    <Suspense fallback={<div className="orc-shell" />}>
      <Aulas searchParams={searchParams as Promise<{ embed?: string }>} />
    </Suspense>
  );
}

async function Aulas({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  const embed = (await searchParams).embed === "1";
  const course = await getCourse("grimorio");
  const lessons = await q<L>("select l.n, l.module, l.title, l.duration, l.kiwify_path, p.live_id from curso.lessons l left join curso.portal_lives p on p.lesson_n = l.n where l.course='grimorio' order by l.n");
  const modules: { name: string; items: L[] }[] = [];
  for (const l of lessons) {
    const m = modules.find((x) => x.name === l.module);
    if (m) m.items.push(l); else modules.push({ name: l.module, items: [l] });
  }
  return (
    <div className={"orc-shell" + (embed ? " orc-embed" : "")}>
      {!embed && <Header active="aulas" />}
      <div className="orc-scroll">
        <main className="orc-col orc-page">
          {embed && <Link href="/oraculo?embed=1" className="orc-btn orc-mb">← Perguntar ao Oráculo</Link>}
          <h1 className="orc-h1">Aulas</h1>
          <p className="orc-muted orc-small">{lessons.length} lives, agrupadas por módulo. Para assistir, abra a aula na Kiwify.</p>
          {modules.map((m) => (
            <section key={m.name} className="orc-module">
              <h2 className="orc-label">{m.name}</h2>
              <ul className="orc-card orc-list">
                {m.items.map((l) => {
                  const k = lessonUrl(course, l.kiwify_path);
                  return (
                    <li key={l.n} className="orc-lesson">
                      <span className="orc-lesson-n">{l.live_id ? "●" : nn(l.n)}</span>
                      <span className="orc-lesson-body">
                        <span className="orc-lesson-title">{shortTitle(l.title)}</span>
                        <span className="orc-muted orc-tiny">{[liveDate(l.title), dur(l.duration)].filter(Boolean).join(" · ")}</span>
                      </span>
                      {l.live_id
                        ? <Link href={`/lives/${l.live_id}`} className="orc-btn">Assistir ▸</Link>
                        : k && <a href={k} target="_blank" rel="noopener noreferrer" className="orc-btn">Kiwify ↗</a>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}

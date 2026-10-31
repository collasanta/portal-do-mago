"use client";
// "Lives anteriores": list of recorded lives. Everyone sees the published ones; the Mago / admins (personal key in
// this browser) also see hidden ones and can rename, hide, reprocess (transcription + Oráculo) or delete.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminAction, adminKey, fmtClock, fmtDate, listLives, type LiveRec } from "@/lib/lives/api";

function status(l: LiveRec) {
  if (l.status === "recording") return "gravando agora";
  const t = l.transcript;
  if (t.status === "pending" || t.status === "running") return `transcrevendo ${t.done}/${t.segments}`;
  if (l.ingest.status === "done") return "no Oráculo ✓";
  if (l.ingest.status === "pending") return "indo pro Oráculo…";
  if (l.ingest.status === "error") return "erro no Oráculo";
  if (t.status === "done" && t.errors) return `transcrição com ${t.errors} falha(s)`;
  if (l.hidden) return "oculta";
  return "";
}

export default function LivesList({ embed }: { embed: boolean }) {
  const [lives, setLives] = useState<LiveRec[] | null>(null);
  const [err, setErr] = useState("");
  const [admin, setAdmin] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const isAdm = !!adminKey();
    setAdmin(isAdm);
    try {
      setLives(await listLives(isAdm));
      setErr("");
    } catch {
      // a key that is not admin anymore: fall back to the public list
      try {
        setLives(await listLives(false));
        setAdmin(false);
      } catch (e) {
        setErr((e as Error).message);
      }
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(l: LiveRec, action: string, extra: Record<string, unknown> = {}) {
    if (action === "delete" && !confirm(`Apagar "${l.title}" de vez? O vídeo e a transcrição somem e o Oráculo esquece essa live.`)) return;
    setBusy(l.id + action);
    try {
      await adminAction(l.id, action, extra);
      setEditing(null);
      await load();
    } catch (e) {
      alert("Não deu: " + (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const q = embed ? "?embed=1" : "";
  return (
    <main className="orc-col orc-page">
      <h1 className="orc-h1">Lives anteriores</h1>
      <p className="orc-muted orc-small orc-mb">
        As lives do Palco ficam gravadas aqui. O Oráculo também aprende com elas e manda direto pro minuto certo.
      </p>
      {err && <p className="lv-err">Não consegui carregar as lives ({err}).</p>}
      {lives === null && !err && <p className="orc-muted orc-center">Carregando…</p>}
      {lives && !lives.length && <p className="orc-muted orc-center">Nenhuma live gravada ainda. A próxima live do Palco aparece aqui.</p>}
      {lives && lives.length > 0 && (
        <ul className="orc-card orc-list">
          {lives.map((l) => (
            <li key={l.id} className={`orc-lesson lv-item ${l.hidden ? "lv-hidden" : ""}`}>
              <span className="lv-play" aria-hidden>
                {l.status === "recording" ? "●" : "▶"}
              </span>
              <span className="orc-lesson-body">
                {editing === l.id ? (
                  <form
                    className="lv-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(l, "rename", { title });
                    }}
                  >
                    <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus aria-label="Título da live" />
                    <button className="orc-btn orc-btn-accent" disabled={!!busy}>
                      Salvar
                    </button>
                    <button type="button" className="orc-btn" onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <Link href={`/lives/${l.id}${q}`} className="orc-lesson-title lv-title">
                    {l.title}
                  </Link>
                )}
                <span className="orc-muted orc-tiny">
                  {[fmtDate(l.startedAt), l.duration ? fmtClock(l.duration) : "", admin && l.room !== "salao" ? `sala ${l.room}` : "", admin ? status(l) : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {admin && (
                  <span className="lv-actions">
                    <button className="orc-btn" onClick={() => (setEditing(l.id), setTitle(l.title))}>
                      Renomear
                    </button>
                    <button className="orc-btn" disabled={!!busy} onClick={() => act(l, l.hidden ? "unhide" : "hide")}>
                      {l.hidden ? "Publicar" : "Ocultar"}
                    </button>
                    <button className="orc-btn" disabled={!!busy || l.status === "recording"} onClick={() => act(l, "reprocess")} title="Transcreve de novo o que falhou e manda pro Oráculo">
                      Reprocessar
                    </button>
                    <button className="orc-btn lv-danger" disabled={!!busy} onClick={() => act(l, "delete")}>
                      Apagar
                    </button>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

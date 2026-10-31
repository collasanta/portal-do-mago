"use client";
import { useEffect, useState } from "react";
import { normLook, type Look } from "@/lib/portal/avatar";
import { checkCode, fetchInfo, type RoomInfo } from "@/lib/portal/net";
import { HatMark } from "./bits";
import { MemberLogin, fetchMe, fetchMemberToken, type Me } from "./MemberLogin";
import { Wardrobe } from "./Wardrobe";

/** mt = member token for this visit (never persisted). */
export type Profile = { name: string; look: Look; code: string; mt?: string };

export function Entry({ initial, onEnter, room = "salao", hasKey = false }: { initial: Profile; onEnter: (p: Profile) => void; room?: string; hasKey?: boolean }) {
  const [name, setName] = useState(initial.name);
  const [look, setLook] = useState<Look>(() => normLook(initial.look));
  const [code, setCode] = useState(initial.code);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [useEmail, setUseEmail] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchInfo(room).then(setInfo);
    fetchMe(room).then(setMe);
    const t = setInterval(() => fetchInfo(room).then((i) => i && setInfo(i)), 15000);
    return () => clearInterval(t);
  }, [room]);
  const refreshMe = () => fetchMe(room).then(setMe);

  // the worker decides; older workers only say codeRequired
  const mode = info?.mode ?? me?.mode ?? "code";
  const showMember = mode === "kiwify" || (mode === "both" && (useEmail || !!me?.email));
  const showCode = mode === "code" ? info?.codeRequired !== false : mode === "both" && !me?.member;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return setErr("Escolhe um nome com pelo menos 2 letras.");
    setBusy(true);
    setErr("");
    let mt: string | undefined;
    const fail = (m: string) => (setBusy(false), setErr(m));
    if (mode !== "code" && me?.member) {
      const t = await fetchMemberToken();
      if (!t.token && !hasKey) return fail(t.error || "Não foi possível confirmar seu acesso.");
      mt = t.token;
    }
    if (mode === "kiwify" && !mt && !hasKey) {
      return fail(me?.email ? "Sua compra do Grimório não está ativa." : "Entre com o e-mail da compra do Grimório para abrir o portal.");
    }
    if (!mt && showCode && !hasKey) {
      const ok = await checkCode(code);
      if (!ok) return fail("Código da sala incorreto. Ele está na mensagem do grupo do WhatsApp.");
    }
    // remember the code on this browser for members-only pages (canView); fire and forget
    if (code.trim()) fetch("/api/portal/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim() }) }).catch(() => {});
    onEnter({ name: n.slice(0, 20), look, code: code.trim(), mt });
  }

  return (
    <div className="pm-entry">
      <div className="pm-win pm-entry-card">
        <div className="pm-win-title">
          <span className="pm-win-ico">
            <HatMark className="pm-hat" />
          </span>
          <span className="pm-win-name">Portal do Mago · Salão do Grimório</span>
        </div>
        <div className="pm-entry-grid">
        <div className="pm-entry-hero">
          <div className="pm-stars" />
          <div className="pm-brand" style={{ fontSize: 18, position: "relative", zIndex: 1 }}>
            <HatMark />
            <span className="txt">
              Portal do <b>Mago</b>
            </span>
          </div>
          <div style={{ position: "relative", zIndex: 1 }}>
            <h1>
              Salão do
              <br />
              <span>Grimório</span>
            </h1>
            <p>A sala dos alunos do Mago do YouTube. Entra, anda pelo salão e troca ideia com a galera que tá produzindo junto.</p>
          </div>
          <div className="pm-online-pill">
            <span className={`pm-dot ${info ? "" : "off"}`} />
            {info ? `${info.online} ${info.online === 1 ? "mago" : "magos"} no salão agora` : "Conectando ao salão…"}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pm-mascot" src="/mago.webp" alt="Mago do YouTube" />
        </div>

        <form className="pm-entry-form" onSubmit={submit}>
          <h2>Monte seu personagem</h2>
          <div>
            <label className="pm-label" htmlFor="pm-name">Seu nome no salão</label>
            <input
              id="pm-name"
              className="pm-input"
              value={name}
              maxLength={20}
              autoComplete="nickname"
              placeholder="Ex.: Ana do canal dark"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <Wardrobe look={look} setLook={setLook} />

          {showMember && <MemberLogin me={me} onChange={refreshMe} />}

          {showCode && (
            <div>
              <label className="pm-label" htmlFor="pm-code">Código da sala</label>
              <input id="pm-code" className="pm-input" value={code} placeholder="Tá na mensagem do grupo" onChange={(e) => setCode(e.target.value)} autoCapitalize="off" autoCorrect="off" />
            </div>
          )}

          {mode === "both" && !me?.email && (
            <button type="button" className="pm-linkbtn" onClick={() => setUseEmail((v) => !v)}>
              {useEmail ? "Usar só o código da sala" : "Entrar com o e-mail da compra"}
            </button>
          )}

          {err && <div className="pm-err">{err}</div>}
          <button className="pm-btn big" disabled={busy}>
            {busy ? "Abrindo o portal…" : "Entrar no salão"}
          </button>
          <p className="pm-fine">
            {mode === "code"
              ? "Sem cadastro e sem senha: seu nome e visual ficam salvos só neste navegador."
              : "Sem senha: a gente confere o e-mail da sua compra na Kiwify. Nome e visual ficam salvos só neste navegador."}{" "}
            Microfone começa desligado, você liga quando quiser.
          </p>
        </form>
        </div>
      </div>
    </div>
  );
}

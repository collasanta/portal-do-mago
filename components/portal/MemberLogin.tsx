"use client";
import { useState } from "react";
import "./member.css";

export type Me = { email: string | null; name: string | null; member: boolean; admin: boolean; role: string | null; mode: "code" | "both" | "kiwify" };

export async function fetchMe(room: string): Promise<Me | null> {
  try {
    const r = await fetch(`/api/portal/me?room=${encodeURIComponent(room)}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, d } as { ok: boolean; d: Record<string, string> };
}

/** Member token for the realtime worker; null when the session is not an active member. */
export async function fetchMemberToken(): Promise<{ token?: string; error?: string }> {
  try {
    const { ok, d } = await post("/api/portal/token", {});
    return ok ? { token: d.token } : { error: d.error || "Não foi possível confirmar seu acesso." };
  } catch {
    return { error: "Sem conexão. Tente de novo." };
  }
}

/** "Entrar com o e-mail da compra": e-mail -> 6-digit code -> session cookie. */
export function MemberLogin({ me, onChange }: { me: Me | null; onChange: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setErr("");
    setMsg("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Digite o e-mail que você usou na compra.");
    setBusy(true);
    const { ok, d } = await post("/api/portal/login/start", { email: email.trim() }).catch(() => ({ ok: false, d: { error: "Sem conexão." } as Record<string, string> }));
    setBusy(false);
    if (!ok) return setErr(d.error || "Não deu certo. Tente de novo.");
    if (d.direct) return onChange();
    setStep("code");
    setCode("");
    setMsg(`Mandamos um código de 6 números para ${email.trim()}. Olhe também o spam.`);
  }

  async function verify() {
    setErr("");
    setBusy(true);
    const { ok, d } = await post("/api/portal/login/verify", { email: email.trim(), code }).catch(() => ({ ok: false, d: { error: "Sem conexão." } as Record<string, string> }));
    setBusy(false);
    if (!ok) return setErr(d.error || "Código inválido.");
    setMsg("");
    onChange();
  }

  async function logout() {
    await post("/api/portal/logout", {}).catch(() => null);
    setStep("email");
    onChange();
  }

  if (me?.email) {
    return (
      <div className="pm-member">
        {me.member ? (
          <div className="pm-member-ok">
            ✓ Membro do Grimório: <b>{me.email}</b>
          </div>
        ) : (
          <div className="pm-err">A compra de {me.email} não está ativa. Se você renovou agora, espere alguns minutos.</div>
        )}
        <button type="button" className="pm-btn ghost small" onClick={logout}>
          Trocar de e-mail
        </button>
      </div>
    );
  }

  return (
    <div className="pm-member">
      {step === "email" ? (
        <>
          <label className="pm-label" htmlFor="pm-email">E-mail da compra do Grimório (Kiwify)</label>
          <div className="pm-member-row">
            <input
              id="pm-email"
              className="pm-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="voce@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="button" className="pm-btn small" disabled={busy} onClick={send}>
              {busy ? "Enviando…" : "Enviar código"}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="pm-label" htmlFor="pm-otp">Código que chegou no seu e-mail</label>
          <div className="pm-member-row">
            <input
              id="pm-otp"
              className="pm-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  verify();
                }
              }}
            />
            <button type="button" className="pm-btn small" disabled={busy || code.length !== 6} onClick={verify}>
              {busy ? "Conferindo…" : "Confirmar"}
            </button>
          </div>
          <button type="button" className="pm-linkbtn" onClick={() => (setStep("email"), setMsg(""), setErr(""))}>
            Trocar e-mail ou pedir outro código
          </button>
        </>
      )}
      {msg && <p className="pm-fine">{msg}</p>}
      {err && <div className="pm-err">{err}</div>}
    </div>
  );
}

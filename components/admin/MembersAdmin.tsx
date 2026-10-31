"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// Admin de membros (Kiwify): lista/busca, adicionar/remover, importar CSV, sincronizar, modo de entrada, URL do webhook.
// Auth: chave admin/host do link mágico (localStorage pdm.admin, a mesma da sala) no header x-portal-key.

type Member = {
  email: string;
  name: string | null;
  status: "active" | "inactive";
  active: boolean;
  source: string;
  product_name: string | null;
  last_event: string | null;
  updated_at: string;
};
type Ev = { id: string; received_at: string; source: string; event_type: string | null; email: string | null; result: string; actor: string | null };
type Data = {
  rows: Member[];
  total: number;
  active: number;
  events: Ev[];
  role: string;
  config: {
    modes: { salao: string; teste: string };
    siteMode: string;
    webhookUrl: string;
    webhookToken: boolean;
    sync: boolean;
    syncMissing: string[];
    mail: boolean;
    memberToken: boolean;
    products: string[];
  };
};

const MODE_LABEL: Record<string, string> = {
  code: "Código da sala (como hoje)",
  both: "Código da sala OU e-mail da compra",
  kiwify: "Só membros (e-mail da compra)",
};

function readKey() {
  try {
    const v = localStorage.getItem("pdm.admin");
    return v ? (JSON.parse(v) as string) : "";
  } catch {
    return "";
  }
}

export default function MembersAdmin() {
  const [key, setKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [csvProduct, setCsvProduct] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setKey(readKey()), []);

  const call = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const r = await fetch(path, {
        ...init,
        cache: "no-store",
        headers: { "content-type": "application/json", ...(key ? { "x-portal-key": key } : {}), ...(init.headers || {}) },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || d.message || `Erro ${r.status}`);
      return d;
    },
    [key],
  );

  const load = useCallback(
    async (search = "") => {
      try {
        setData(await call(`/api/portal/members?q=${encodeURIComponent(search)}`));
        setErr("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setData(null);
      }
    },
    [call],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (key !== null) load();
  }, [key, load]);

  async function act(label: string, fn: () => Promise<{ message?: string } | void>) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const r = await fn();
      if (r && r.message) setMsg(r.message);
      await load(q);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const add = () =>
    act("add", async () => {
      await call("/api/portal/members", { method: "POST", body: JSON.stringify({ email: addEmail, name: addName }) });
      setAddEmail("");
      setAddName("");
      return { message: `${addEmail.trim().toLowerCase()} liberado.` };
    });
  const setStatus = (email: string, status: "active" | "inactive") =>
    act(email, async () => {
      await call("/api/portal/members", { method: "POST", body: JSON.stringify({ email, status }) });
      return { message: `${email}: ${status === "active" ? "ativado" : "desativado"}.` };
    });
  const remove = (email: string) => {
    if (!confirm(`Remover ${email} da lista? (perde o acesso; uma compra nova na Kiwify adiciona de volta)`)) return;
    act(email, async () => {
      await call(`/api/portal/members?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      return { message: `${email} removido.` };
    });
  };
  const sync = (dry: boolean) => act("sync", () => call("/api/portal/members/sync", { method: "POST", body: JSON.stringify({ dry }) }));
  const importCsv = (dry: boolean) =>
    act("csv", async () => {
      const f = fileRef.current?.files?.[0];
      if (!f) throw new Error("Escolha o arquivo CSV exportado da Kiwify (Vendas → Exportar).");
      const csv = await f.text();
      return call("/api/portal/members/import", { method: "POST", body: JSON.stringify({ csv, product: csvProduct, dry }) });
    });

  if (key === null) return <div className="mb-shell" />;

  if (!key || (err && !data)) {
    return (
      <div className="mb-shell">
        <form
          className="mb-gate mb-card"
          onSubmit={(e) => {
            e.preventDefault();
            const k = keyInput.trim();
            try {
              localStorage.setItem("pdm.admin", JSON.stringify(k));
            } catch {}
            fetch("/api/portal/staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: k }) }).catch(() => {});
            setKey(k);
          }}
        >
          <h2>Membros do Portal</h2>
          <p className="mb-msg">Só admin ou host. Abra pelo seu link mágico do salão (com ?k=) ou cole sua chave pessoal aqui.</p>
          {err && <p className="mb-msg err">{err}</p>}
          <input className="mb-in" type="password" placeholder="Chave pessoal" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
          <button className="mb-btn pri">Entrar</button>
        </form>
      </div>
    );
  }

  const c = data?.config;
  return (
    <div className="mb-shell">
      <div className="mb-wrap">
        <div className="mb-head">
          <h1>Membros</h1>
          {data && (
            <span className="mb-small">
              {data.active} ativos de {data.total} · você é {data.role === "host" ? "host" : "admin"}
            </span>
          )}
          <Link href="/">← Voltar ao salão</Link>
        </div>

        {msg && <div className="mb-card mb-msg">{msg}</div>}
        {err && <div className="mb-card mb-msg err">{err}</div>}

        {c && (
          <div className="mb-grid">
            <div className="mb-card">
              <h2>Quem entra</h2>
              <dl className="mb-kv">
                <dt>Salão</dt>
                <dd>{MODE_LABEL[c.modes.salao] || c.modes.salao}</dd>
                <dt>Sala teste</dt>
                <dd>{MODE_LABEL[c.modes.teste] || c.modes.teste}</dd>
              </dl>
              <p className="mb-small">Chaves de admin/host sempre entram. Trocar o modo é uma variável no servidor (AUTH_MODE): veja docs/KIWIFY.md.</p>
            </div>
            <div className="mb-card">
              <h2>Webhook da Kiwify</h2>
              <div className="mb-copy">{c.webhookUrl}</div>
              <p className="mb-small" style={{ marginTop: 8 }}>
                Token: <span className={`mb-pill ${c.webhookToken ? "on" : "off"}`}>{c.webhookToken ? "configurado" : "falta"}</span>{" "}
                Produtos: {c.products.length ? c.products.join(", ") : "todos da conta"}
              </p>
              <p className="mb-small">Eventos: compra aprovada, assinatura renovada → ativo; atrasada, cancelada, reembolso, chargeback → inativo.</p>
            </div>
            <div className="mb-card">
              <h2>Sincronizar com a Kiwify</h2>
              <p className="mb-small">
                Lê as vendas pela API (pagas → ativo; reembolso/chargeback → inativo). Cancelamento de assinatura só chega pelo webhook.
              </p>
              {c.sync ? (
                <div className="mb-row">
                  <button className="mb-btn pri" disabled={!!busy} onClick={() => sync(false)}>
                    {busy === "sync" ? "Sincronizando…" : "Sincronizar"}
                  </button>
                  <button className="mb-btn" disabled={!!busy} onClick={() => sync(true)}>
                    Simular
                  </button>
                </div>
              ) : (
                <p className="mb-msg err">Desligado: faltam {c.syncMissing.join(", ")}.</p>
              )}
              <p className="mb-small">
                E-mail de login: <span className={`mb-pill ${c.mail ? "on" : "off"}`}>{c.mail ? "ok" : "falta"}</span> Token do salão:{" "}
                <span className={`mb-pill ${c.memberToken ? "on" : "off"}`}>{c.memberToken ? "ok" : "falta"}</span>
              </p>
            </div>
          </div>
        )}

        <div className="mb-grid">
          <div className="mb-card">
            <h2>Liberar um e-mail</h2>
            <div className="mb-row">
              <input className="mb-in" type="email" placeholder="email@da-compra.com" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
              <input className="mb-in" placeholder="Nome (opcional)" value={addName} onChange={(e) => setAddName(e.target.value)} />
              <button className="mb-btn pri" disabled={!!busy || !addEmail.includes("@")} onClick={add}>
                Liberar
              </button>
            </div>
          </div>
          <div className="mb-card">
            <h2>Importar CSV da Kiwify</h2>
            <div className="mb-row">
              <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="mb-in" style={{ paddingTop: 6 }} />
              <input className="mb-in" placeholder="Filtrar produto (texto, opcional)" value={csvProduct} onChange={(e) => setCsvProduct(e.target.value)} />
            </div>
            <div className="mb-row" style={{ marginTop: 8 }}>
              <button className="mb-btn" disabled={!!busy} onClick={() => importCsv(true)}>
                Simular
              </button>
              <button className="mb-btn pri" disabled={!!busy} onClick={() => importCsv(false)}>
                {busy === "csv" ? "Importando…" : "Importar"}
              </button>
            </div>
            <p className="mb-small">Vendas → Exportar (CSV). Também aceita uma lista simples de e-mails, um por linha.</p>
          </div>
        </div>

        <div className="mb-card">
          <form
            className="mb-row"
            onSubmit={(e) => {
              e.preventDefault();
              load(q);
            }}
          >
            <input className="mb-in" placeholder="Buscar por e-mail ou nome" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="mb-btn">Buscar</button>
          </form>
          <div className="mb-scroll" style={{ marginTop: 10 }}>
            <table className="mb-table">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th className="mb-hide-sm">Nome</th>
                  <th>Status</th>
                  <th className="mb-hide-sm">Origem</th>
                  <th className="mb-hide-sm">Último evento</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((m) => (
                  <tr key={m.email}>
                    <td>{m.email}</td>
                    <td className="mb-hide-sm">{m.name || "—"}</td>
                    <td>
                      <span className={`mb-pill ${m.active ? "on" : "off"}`}>{m.active ? "ativo" : "inativo"}</span>
                    </td>
                    <td className="mb-hide-sm">{m.source}</td>
                    <td className="mb-hide-sm">
                      {m.last_event || "—"}
                      <div className="mb-small">{new Date(m.updated_at).toLocaleString("pt-BR")}</div>
                    </td>
                    <td>
                      <div className="mb-row">
                        {m.active ? (
                          <button className="mb-btn sm" disabled={!!busy} onClick={() => setStatus(m.email, "inactive")}>
                            Desativar
                          </button>
                        ) : (
                          <button className="mb-btn sm" disabled={!!busy} onClick={() => setStatus(m.email, "active")}>
                            Ativar
                          </button>
                        )}
                        <button className="mb-btn sm danger" disabled={!!busy} onClick={() => remove(m.email)}>
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data && !data.rows.length && (
                  <tr>
                    <td colSpan={6} className="mb-msg">
                      Nenhum membro{q ? " com essa busca" : " ainda"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {data && (
          <div className="mb-card">
            <h2>Últimos eventos</h2>
            <div className="mb-scroll">
              <table className="mb-table">
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td className="mb-small">{new Date(e.received_at).toLocaleString("pt-BR")}</td>
                      <td>{e.source}</td>
                      <td className="mb-hide-sm">{e.event_type || "—"}</td>
                      <td>{e.email || "—"}</td>
                      <td className="mb-small">{e.result}</td>
                    </tr>
                  ))}
                  {!data.events.length && (
                    <tr>
                      <td className="mb-msg">Nada ainda.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

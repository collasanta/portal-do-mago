"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOOK, randomLook } from "@/lib/portal/art";
import { Entry, type Profile } from "./Entry";
import { Room } from "./Room";
import "./portal.css";

const KEY = "pdm.profile";
const UID = "pdm.uid";
const ADMIN = "pdm.admin";

function load<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export function Portal() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile>({ name: "", look: DEFAULT_LOOK, code: "" });
  const [inRoom, setInRoom] = useState(false);
  const [uid, setUid] = useState("");
  const [adminKey, setAdminKey] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const [room, setRoom] = useState("salao");

  useEffect(() => {
    const url = new URL(window.location.href);
    const saved = load<Profile>(KEY);
    const urlCode = url.searchParams.get("c");
    if (urlCode) save("pdm.code", urlCode);
    const code = urlCode || load<string>("pdm.code") || saved?.code || "";
    let id = load<string>(UID);
    if (!id) {
      id = crypto.randomUUID();
      save(UID, id);
    }
    // magic link: /?c=<code>&k=<personal key> (k = named host/admin key; legacy ?admin= still works)
    const adm = url.searchParams.get("k") || url.searchParams.get("admin");
    if (adm) save(ADMIN, adm);
    if (adm === "off") localStorage.removeItem(ADMIN);
    const a = load<string>(ADMIN);
    // keep the code out of the visible URL once captured
    // ?sala=teste: a separate room (own Durable Object) for rehearsals and tests
    const sala = (url.searchParams.get("sala") || "").replace(/[^a-z0-9-]/gi, "").slice(0, 32);
    if (url.searchParams.has("c") || url.searchParams.has("admin") || url.searchParams.has("k")) {
      url.searchParams.delete("c");
      url.searchParams.delete("admin");
      url.searchParams.delete("k");
      history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setUid(id);
    if (sala) setRoom(sala);
    setAdminKey(a && a !== "off" ? a : undefined);
    // site sessions for members-only pages (lib/portal/access.ts): admin key -> pm_adm, saved room code -> pm_code
    const post = (path: string, body: unknown) =>
      fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    if (a && a !== "off") post("/api/portal/staff", { key: a });
    if (code) post("/api/portal/code", { code });
    setProfile({ name: saved?.name || "", look: saved?.look || randomLook(), code });
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const enter = useCallback((p: Profile) => {
    // the member token lives only in memory for this visit
    save(KEY, { name: p.name, look: p.look, code: p.code });
    setProfile(p);
    setNotice("");
    setInRoom(true);
  }, []);

  const leave = useCallback((reason?: string) => {
    setInRoom(false);
    if (reason) setNotice(reason);
  }, []);

  if (!ready) return <div style={{ position: "fixed", inset: 0, background: "var(--pm-bg)" }} />;
  if (inRoom) return <Room profile={profile} uid={uid} adminKey={adminKey} room={room} onLeave={leave} />;
  return (
    <>
      {notice && <div className="pm-toast">{notice}</div>}
      <Entry initial={profile} onEnter={enter} room={room} hasKey={!!adminKey} />
    </>
  );
}

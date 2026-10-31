import { Suspense } from "react";
import { notFound } from "next/navigation";
import Header from "@/components/oraculo/Header";
import LivePlayer from "@/components/lives/LivePlayer";
import { canView } from "@/lib/portal/access";

async function Player({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; embed?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id) || !(await canView())) notFound();
  const t = Math.max(0, Math.floor(Number(sp.t) || 0));
  const embed = sp.embed === "1";
  return (
    <div className={"orc-shell" + (embed ? " orc-embed" : "")}>
      {!embed && <Header active="lives" />}
      <div className="orc-scroll">
        <LivePlayer id={id} t={t} embed={embed} />
      </div>
    </div>
  );
}

export default function LivePage({ params, searchParams }: PageProps<"/lives/[id]">) {
  return (
    <Suspense fallback={<div className="orc-shell" />}>
      <Player params={params} searchParams={searchParams as Promise<{ t?: string; embed?: string }>} />
    </Suspense>
  );
}

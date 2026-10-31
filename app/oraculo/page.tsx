import { Suspense } from "react";
import Chat from "@/components/oraculo/Chat";

async function ChatFromParams({ searchParams }: { searchParams: Promise<{ c?: string; embed?: string }> }) {
  const sp = await searchParams;
  const c = Number(sp.c);
  return <Chat initialId={Number.isInteger(c) && c > 0 ? c : null} embed={sp.embed === "1"} />;
}

export default function OraculoPage({ searchParams }: PageProps<"/oraculo">) {
  return (
    <Suspense fallback={<div className="orc-shell" />}>
      <ChatFromParams searchParams={searchParams as Promise<{ c?: string; embed?: string }>} />
    </Suspense>
  );
}

import { Suspense } from "react";
import { notFound } from "next/navigation";
import LinksBoard from "@/components/links/LinksBoard";
import { canView } from "@/lib/portal/access";
import { listLinks } from "@/lib/portal/links";

// cacheComponents is on: everything dynamic (DB, searchParams) lives under Suspense.
async function Links({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  const sp = await searchParams;
  if (!(await canView())) notFound();
  const links = await listLinks().catch(() => null);
  return <LinksBoard initial={links} embed={sp.embed === "1"} />;
}

export default function LinksPage({ searchParams }: PageProps<"/links">) {
  return (
    <Suspense fallback={<div className="lk-shell" />}>
      <Links searchParams={searchParams as Promise<{ embed?: string }>} />
    </Suspense>
  );
}

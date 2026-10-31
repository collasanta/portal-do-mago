import { Suspense } from "react";
import { notFound } from "next/navigation";
import Header from "@/components/oraculo/Header";
import LivesList from "@/components/lives/LivesList";
import { canView } from "@/lib/portal/access";

// cacheComponents is on: request-time work (searchParams, access check) stays under Suspense.
async function Lives({ searchParams }: { searchParams: Promise<{ embed?: string }> }) {
  const embed = (await searchParams).embed === "1";
  if (!(await canView())) notFound();
  return (
    <div className={"orc-shell" + (embed ? " orc-embed" : "")}>
      {!embed && <Header active="lives" />}
      <div className="orc-scroll">
        <LivesList embed={embed} />
      </div>
    </div>
  );
}

export default function LivesPage({ searchParams }: PageProps<"/lives">) {
  return (
    <Suspense fallback={<div className="orc-shell" />}>
      <Lives searchParams={searchParams as Promise<{ embed?: string }>} />
    </Suspense>
  );
}

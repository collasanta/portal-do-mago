import { getVisitor } from "@/lib/oraculo/visitor";
import { q } from "@/lib/oraculo/db";


export async function GET(req: Request) {
  const v = await getVisitor(req);
  if (!v) return Response.json({ error: "Recarregue a página para continuar." }, { status: 401 });
  const rows = await q(
    "select id::int, title, updated_at from curso.conversations where visitor_id=$1 order by updated_at desc limit 200",
    [v.id],
  );
  return Response.json({ conversations: rows }, { headers: { "cache-control": "no-store" } });
}

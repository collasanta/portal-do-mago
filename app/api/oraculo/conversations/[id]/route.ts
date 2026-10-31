import { getVisitor, sameOrigin } from "@/lib/oraculo/visitor";
import { q } from "@/lib/oraculo/db";


type Ctx = { params: Promise<{ id: string }> };
const unauthorized = () => Response.json({ error: "Recarregue a página para continuar." }, { status: 401 });

export async function GET(req: Request, ctx: Ctx) {
  const v = await getVisitor(req);
  if (!v) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "not found" }, { status: 404 });
  const [conv] = await q("select id::int, title from curso.conversations where id=$1 and visitor_id=$2", [id, v.id]);
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  const messages = await q(
    `select m.id::int, m.role, m.content, m.citations from curso.messages m
     join curso.conversations c on c.id = m.conversation_id
     where m.conversation_id=$1 and c.visitor_id=$2 order by m.id`,
    [id, v.id],
  );
  return Response.json({ conversation: conv, messages }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const v = await getVisitor(req);
  if (!v) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "not found" }, { status: 404 });
  await q("delete from curso.conversations where id=$1 and visitor_id=$2", [id, v.id]);
  return Response.json({ ok: true });
}

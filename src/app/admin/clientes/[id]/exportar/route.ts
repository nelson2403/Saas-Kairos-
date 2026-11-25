import { NextResponse } from "next/server";
import { getMembership } from "@/lib/auth/dal";
import { canHandlePrivacy, exportCustomer } from "@/modules/partners/service";

/** Exportação dos dados do titular (LGPD). Só proprietário/administrador; sem cache. */
export async function GET(_request: Request, ctx: RouteContext<"/admin/clientes/[id]/exportar">) {
  const membership = await getMembership();
  if (!membership) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!canHandlePrivacy(membership.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const data = await exportCustomer(id);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="cliente-${id}.json"`,
      "cache-control": "no-store",
    },
  });
}

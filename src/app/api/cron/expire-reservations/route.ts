import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Agendamento (Vercel Cron): cancela pedidos da loja com reserva vencida.
 * Protegido por CRON_SECRET (a Vercel envia "Authorization: Bearer <segredo>").
 * As reservas também expiram a cada visita ao carrinho e a cada checkout.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("fn_expire_reservations");
  if (error) return NextResponse.json({ error: "falha ao expirar reservas" }, { status: 500 });
  return NextResponse.json({ expired: data });
}

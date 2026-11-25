"use server";

import { headers } from "next/headers";
import { placeOrder, quoteCart, type CheckoutResult, type QuoteLine } from "@/modules/store/service";

/** Preço e disponibilidade atuais dos itens do carrinho. */
export async function quoteCartAction(ids: string[]): Promise<QuoteLine[]> {
  if (!Array.isArray(ids)) return [];
  return quoteCart(ids.filter((id) => typeof id === "string"));
}

/** Finaliza o pedido da loja (validado e limitado por origem no servidor). */
export async function placeOrderAction(input: unknown): Promise<CheckoutResult> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconhecido";
  return placeOrder(input, ip);
}

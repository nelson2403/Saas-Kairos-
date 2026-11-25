"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "./cart";

export function CartButton() {
  const { count } = useCart();
  return (
    <Link href="/carrinho" className="relative inline-flex size-11 items-center justify-center rounded-md hover:bg-muted" aria-label={`Carrinho, ${count} ${count === 1 ? "item" : "itens"}`}>
      <ShoppingBag className="size-5" aria-hidden />
      {count > 0 && (
        <span className="absolute right-1 top-1 min-w-5 rounded-full bg-tinta px-1 text-center text-[0.7rem] leading-5 text-marfim tabular-nums">{count > 99 ? "99+" : count}</span>
      )}
    </Link>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_QTY_PER_ITEM } from "@/modules/store/domain";
import { useCart } from "./cart";

export function AddToCart({ productId, available, enabled }: { productId: string; available: number; enabled: boolean }) {
  const { add, lines } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const inCart = lines.find((l) => l.id === productId)?.qty ?? 0;
  const max = Math.max(0, Math.min(Math.floor(available) - inCart, MAX_QTY_PER_ITEM));

  if (!enabled) return <p className="text-sm text-muted-foreground">A loja não está recebendo pedidos no momento.</p>;
  if (available <= 0) return <Button disabled className="w-full sm:w-auto">Esgotado</Button>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-md border border-border">
          <Button type="button" variant="ghost" size="icon" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade" disabled={qty <= 1}>
            <Minus aria-hidden />
          </Button>
          <span className="w-10 text-center tabular-nums" aria-live="polite">
            {qty}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={() => setQty((q) => Math.min(max || 1, q + 1))} aria-label="Aumentar quantidade" disabled={qty >= max}>
            <Plus aria-hidden />
          </Button>
        </div>
        <Button
          type="button"
          size="lg"
          disabled={max <= 0}
          onClick={() => {
            add(productId, Math.min(qty, max));
            setAdded(true);
            setQty(1);
          }}
        >
          {added ? <Check aria-hidden /> : <ShoppingBag aria-hidden />}
          {max <= 0 ? "Quantidade máxima no carrinho" : added ? "Adicionado" : "Adicionar ao carrinho"}
        </Button>
      </div>
      {added && (
        <p role="status" className="text-sm">
          Produto no carrinho.{" "}
          <Link href="/carrinho" className="underline">
            Ver carrinho e finalizar
          </Link>
        </p>
      )}
    </div>
  );
}

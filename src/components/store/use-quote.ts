"use client";

import { useEffect, useState } from "react";
import { quoteCartAction } from "@/app/(store)/actions";
import type { QuoteLine } from "@/modules/store/service";
import { useCart } from "./cart";

/** Junta o carrinho do aparelho com preço/disponibilidade atuais do servidor. */
export function useQuote() {
  const cart = useCart();
  const ids = cart.lines.map((l) => l.id).join(",");
  const [quote, setQuote] = useState<{ ids: string; lines: QuoteLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    quoteCartAction(ids.split(","))
      .then((lines) => {
        if (!cancelled) {
          setQuote({ ids, lines });
          setError(null);
        }
      })
      .catch(() => !cancelled && setError("Não foi possível atualizar preços e estoque. Verifique a conexão."));
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const byId = new Map((quote?.lines ?? []).map((l) => [l.id, l]));
  const loading = !!ids && quote?.ids !== ids && !error;
  const items = cart.lines.map((l) => ({ ...l, info: byId.get(l.id) }));
  const valid = items.filter((i) => i.info && i.info.available > 0);
  const subtotal = Math.round(valid.reduce((s, i) => s + Math.round(Math.min(i.qty, i.info!.available) * i.info!.price * 100) / 100, 0) * 100) / 100;
  const problems = items.filter((i) => quote?.ids === ids && (!i.info || i.info.available < i.qty));

  return { cart, items, loading, error, subtotal, problems, ready: !ids || quote?.ids === ids };
}

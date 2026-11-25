"use client";

import Image from "next/image";
import Link from "next/link";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useQuote } from "@/components/store/use-quote";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/modules/inventory/domain";
import { productImageUrl } from "@/modules/inventory/images";
import { MAX_QTY_PER_ITEM } from "@/modules/store/domain";

export function CartView() {
  const { cart, items, loading, error, subtotal, problems, ready } = useQuote();

  if (cart.lines.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Seu carrinho está vazio.</p>
        <Link href="/produtos" className={buttonVariants()}>
          Ver produtos
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-border border-y border-border">
        {items.map(({ id, qty, info }) => {
          const unavailable = ready && (!info || info.available <= 0);
          const limited = info && info.available > 0 && info.available < qty;
          const max = Math.min(info ? Math.floor(info.available) : 0, MAX_QTY_PER_ITEM);
          return (
            <li key={id} className="flex gap-4 py-4">
              <div className="relative size-20 shrink-0 overflow-hidden rounded-md bg-linho">
                {info?.image_path && <Image src={productImageUrl(info.image_path)} alt="" fill sizes="80px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {info ? (
                  <Link href={`/p/${info.slug}`} className="font-display text-lg hover:underline">
                    {info.name}
                  </Link>
                ) : (
                  <p className="text-muted-foreground">{ready ? "Produto indisponível" : "Carregando…"}</p>
                )}
                {info && <p className="text-sm tabular-nums text-muted-foreground">{formatMoney(info.price)} cada</p>}
                {unavailable && <p className="text-sm text-danger">Não está mais disponível. Remova para continuar.</p>}
                {limited && <p className="text-sm text-warning">Só restam {Math.floor(info.available)}. Ajuste a quantidade.</p>}
                <div className="flex items-center gap-2 pt-1">
                  <div className="inline-flex items-center rounded-md border border-border">
                    <Button type="button" variant="ghost" size="icon" onClick={() => cart.setQty(id, qty - 1)} aria-label="Diminuir quantidade">
                      <Minus aria-hidden />
                    </Button>
                    <span className="w-8 text-center tabular-nums">{qty}</span>
                    <Button type="button" variant="ghost" size="icon" onClick={() => cart.setQty(id, qty + 1)} disabled={!info || qty >= max} aria-label="Aumentar quantidade">
                      <Plus aria-hidden />
                    </Button>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => cart.remove(id)}>
                    <Trash2 aria-hidden /> Remover
                  </Button>
                </div>
              </div>
              <p className="whitespace-nowrap tabular-nums">{info ? formatMoney(Math.round(qty * info.price * 100) / 100) : ""}</p>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col items-end gap-3">
        <p className="text-lg">
          Subtotal: <strong className="tabular-nums">{loading ? "…" : formatMoney(subtotal)}</strong>
        </p>
        <p className="text-xs text-muted-foreground">Frete (se houver entrega) é calculado no próximo passo.</p>
        {problems.length > 0 ? (
          <p className="text-sm text-danger">Ajuste os itens destacados para continuar.</p>
        ) : (
          <Link href="/checkout" className={buttonVariants({ size: "lg" })} aria-disabled={loading}>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            Finalizar pedido
          </Link>
        )}
      </div>
    </div>
  );
}

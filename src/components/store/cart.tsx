"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CART_STORAGE_KEY, MAX_QTY_PER_ITEM, parseCart, type CartLine } from "@/modules/store/domain";

/**
 * Carrinho guardado no aparelho (localStorage). Contém só id e quantidade:
 * preço e disponibilidade são sempre consultados no servidor.
 */
const EVENT = "kairos-cart-change";
let cachedRaw: string | null | undefined;
let cachedCart: CartLine[] = [];

function read(): CartLine[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(CART_STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedCart = parseCart(raw);
  }
  return cachedCart;
}

function write(lines: CartLine[]) {
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // outras abas
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const EMPTY: CartLine[] = [];

export function useCart() {
  const lines = useSyncExternalStore(subscribe, read, () => EMPTY);

  const add = useCallback((id: string, qty = 1) => {
    const current = read();
    const existing = current.find((l) => l.id === id);
    write(
      existing
        ? current.map((l) => (l.id === id ? { ...l, qty: Math.min(l.qty + qty, MAX_QTY_PER_ITEM) } : l))
        : [...current, { id, qty: Math.min(qty, MAX_QTY_PER_ITEM) }],
    );
  }, []);

  const setQty = useCallback((id: string, qty: number) => {
    const current = read();
    write(qty <= 0 ? current.filter((l) => l.id !== id) : current.map((l) => (l.id === id ? { ...l, qty: Math.min(qty, MAX_QTY_PER_ITEM) } : l)));
  }, []);

  const remove = useCallback((id: string) => write(read().filter((l) => l.id !== id)), []);
  const clear = useCallback(() => write([]), []);

  return { lines, count: lines.reduce((s, l) => s + l.qty, 0), add, setQty, remove, clear };
}

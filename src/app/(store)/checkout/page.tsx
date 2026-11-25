import type { Metadata } from "next";
import { Suspense } from "react";
import { getStoreSettings } from "@/modules/store/data";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Finalizar pedido", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
      <h1 className="mb-6 font-display text-4xl">Finalizar pedido</h1>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
        <Checkout />
      </Suspense>
    </main>
  );
}

async function Checkout() {
  const settings = await getStoreSettings();
  if (!settings?.enabled) return <p className="text-muted-foreground">A loja não está recebendo pedidos no momento.</p>;
  return <CheckoutForm settings={settings} />;
}

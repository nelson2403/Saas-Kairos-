import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeSections } from "@/components/store/home-sections";
import { StorefrontChrome } from "@/components/store/storefront-chrome";
import { getStoreSettings } from "@/modules/store/data";
import { getDraftStorefront } from "@/modules/storefront/service";

export const metadata: Metadata = { title: "Prévia da loja", robots: { index: false, follow: false } };

/** Prévia do RASCUNHO (somente equipe logada; aberta dentro do editor). */
export default function PreviewPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh animate-pulse bg-muted" />}>
      <Preview />
    </Suspense>
  );
}

async function Preview() {
  const [config, settings] = await Promise.all([getDraftStorefront(), getStoreSettings()]);
  return (
    <StorefrontChrome config={config} settings={settings} preview>
      <HomeSections config={config} settings={settings} />
    </StorefrontChrome>
  );
}

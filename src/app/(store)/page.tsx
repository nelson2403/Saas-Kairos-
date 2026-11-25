import type { Metadata } from "next";
import { Suspense } from "react";
import { GridSkeleton } from "@/components/store/grid-skeleton";
import { HomeSections } from "@/components/store/home-sections";
import { getStoreSettings } from "@/modules/store/data";
import { getPublishedStorefront } from "@/modules/storefront/service";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = await getPublishedStorefront();
  return {
    title: { absolute: seo.title || "Kairós" },
    description: seo.description || undefined,
    alternates: { canonical: "/" },
    openGraph: { type: "website", title: seo.title || "Kairós", description: seo.description || undefined, locale: "pt_BR" },
  };
}

export default function StoreHome() {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const [config, settings] = await Promise.all([getPublishedStorefront(), getStoreSettings()]);
  return <HomeSections config={config} settings={settings} />;
}

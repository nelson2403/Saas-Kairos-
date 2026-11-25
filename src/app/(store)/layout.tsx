import { Suspense } from "react";
import { StorefrontChrome } from "@/components/store/storefront-chrome";
import { getStoreSettings } from "@/modules/store/data";
import { getPublishedStorefront } from "@/modules/storefront/service";

/** A loja pública usa SEMPRE a versão publicada da personalização. */
export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <Themed>{children}</Themed>
    </Suspense>
  );
}

async function Themed({ children }: { children: React.ReactNode }) {
  const [config, settings] = await Promise.all([getPublishedStorefront(), getStoreSettings()]);
  return (
    <StorefrontChrome config={config} settings={settings}>
      {children}
    </StorefrontChrome>
  );
}

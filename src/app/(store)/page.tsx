import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { GridSkeleton } from "@/components/store/grid-skeleton";
import { ProductCard } from "@/components/store/product-card";
import { buttonVariants } from "@/components/ui/button";
import { getStoreCategories, getStoreProducts, getStoreSettings } from "@/modules/store/data";

export const metadata: Metadata = {
  title: { absolute: "Kairós — Onde o agora se torna abrigo" },
  description: "Loja virtual da Kairós. Onde o agora se torna abrigo.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", title: "Kairós", description: "Onde o agora se torna abrigo.", locale: "pt_BR" },
};

export default function StoreHome() {
  return (
    <main>
      <section className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center md:py-24">
        <Logo withTagline className="[&>span:first-child]:text-5xl md:[&>span:first-child]:text-6xl" />
        <Link href="/produtos" className={buttonVariants({ size: "lg" })}>
          Ver produtos <ArrowRight aria-hidden />
        </Link>
      </section>
      <Suspense fallback={<GridSkeleton />}>
        <Featured />
      </Suspense>
    </main>
  );
}

async function Featured() {
  const [settings, { products }, categories] = await Promise.all([getStoreSettings(), getStoreProducts({ page: 1 }), getStoreCategories()]);
  if (!settings?.enabled || products.length === 0) {
    return <p className="mx-auto max-w-md px-4 text-center text-sm text-muted-foreground">Nossa loja online está sendo preparada com cuidado. Em breve.</p>;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 md:px-6">
      {categories.length > 0 && (
        <nav aria-label="Categorias" className="flex flex-wrap justify-center gap-2">
          {categories
            .filter((c) => !c.parent_id)
            .map((c) => (
              <Link key={c.id} href={`/produtos?categoria=${c.id}`} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
                {c.name}
              </Link>
            ))}
        </nav>
      )}
      <section>
        <h2 className="mb-6 font-display text-3xl">Novidades</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
          {products.slice(0, 8).map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link href="/produtos" className={buttonVariants({ variant: "outline" })}>
            Ver todos os produtos
          </Link>
        </div>
      </section>
    </div>
  );
}

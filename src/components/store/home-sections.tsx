import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProductCard } from "@/components/store/product-card";
import { Scheduled } from "@/components/store/scheduled";
import { StoreLogo } from "@/components/store/storefront-chrome";
import { buttonVariants } from "@/components/ui/button";
import { getStoreCategories, getStoreProducts } from "@/modules/store/data";
import type { StoreSettings } from "@/modules/store/domain";
import { storeAssetUrl } from "@/modules/storefront/assets";
import type { Section, Storefront } from "@/modules/storefront/schema";

/** Página inicial montada a partir das seções configuradas (publicado ou rascunho). */
export async function HomeSections({ config, settings }: { config: Storefront; settings: StoreSettings | null }) {
  const open = !!settings?.enabled;
  const sections = config.sections.filter((s) => s.visible);
  const [categories] = await Promise.all([getStoreCategories()]);
  const rendered = await Promise.all(sections.map((s, i) => renderSection(s, i, config, open, categories)));
  return (
    <main className="space-y-16 pb-8">
      {rendered}
      {!open && <p className="mx-auto max-w-md px-4 text-center text-sm text-muted-foreground">Nossa loja online está sendo preparada com cuidado. Em breve.</p>}
    </main>
  );
}

async function renderSection(
  s: Section,
  index: number,
  config: Storefront,
  open: boolean,
  categories: { id: string; name: string; parent_id: string | null }[],
) {
  switch (s.type) {
    case "hero":
      return (
        <section key={s.id} className="relative overflow-hidden">
          {s.image_path && (
            <>
              <Image src={storeAssetUrl(s.image_path)} alt="" fill priority={index === 0} sizes="100vw" className="object-cover" />
              <div className="absolute inset-0 bg-background/55" aria-hidden />
            </>
          )}
          <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center md:py-28">
            {s.show_logo && <StoreLogo config={config} size="lg" />}
            {s.title && <h1 className="max-w-3xl font-display text-4xl leading-tight md:text-6xl">{s.title}</h1>}
            {s.subtitle && <p className="max-w-xl text-muted-foreground md:text-lg">{s.subtitle}</p>}
            {open && s.button_text && s.button_link && (
              <Link href={s.button_link} className={buttonVariants({ size: "lg" })}>
                {s.button_text} <ArrowRight aria-hidden />
              </Link>
            )}
          </div>
        </section>
      );

    case "featured": {
      if (!open) return null;
      const { products } = await getStoreProducts({ category: s.category_id, page: 1 });
      if (!products.length) return null;
      return (
        <section key={s.id} className="mx-auto max-w-6xl px-4 md:px-6">
          {s.title && <h2 className="mb-6 font-display text-3xl">{s.title}</h2>}
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
            {products.slice(0, s.limit).map((p, i) => (
              <ProductCard key={p.id} product={p} priority={index < 2 && i < 4} />
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href={s.category_id ? `/produtos?categoria=${s.category_id}` : "/produtos"} className={buttonVariants({ variant: "outline" })}>
              Ver todos
            </Link>
          </div>
        </section>
      );
    }

    case "categories": {
      const top = categories.filter((c) => !c.parent_id);
      if (!open || !top.length) return null;
      return (
        <section key={s.id} className="mx-auto max-w-6xl px-4 md:px-6">
          {s.title && <h2 className="mb-6 text-center font-display text-3xl">{s.title}</h2>}
          <nav aria-label="Categorias" className="flex flex-wrap justify-center gap-2">
            {top.map((c) => (
              <Link key={c.id} href={`/produtos?categoria=${c.id}`} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
                {c.name}
              </Link>
            ))}
          </nav>
        </section>
      );
    }

    case "banner": {
      if (!s.image_path) return null;
      const img = (
        <div className="relative aspect-[16/7] overflow-hidden rounded-lg bg-muted md:aspect-[16/5]">
          <Image src={storeAssetUrl(s.image_path)} alt={s.alt} fill sizes="(max-width: 1200px) 100vw, 1200px" className="object-cover" />
        </div>
      );
      return (
        <Scheduled key={s.id} startsAt={s.starts_at} endsAt={s.ends_at}>
          <section className="mx-auto max-w-6xl px-4 md:px-6">
            {s.link ? (
              <Link href={s.link} className="block">
                {img}
              </Link>
            ) : (
              img
            )}
          </section>
        </Scheduled>
      );
    }

    case "text":
      if (!s.title && !s.body) return null;
      return (
        <section key={s.id} className="mx-auto max-w-3xl px-4 text-center md:px-6">
          {s.title && <h2 className="mb-4 font-display text-3xl">{s.title}</h2>}
          {s.body && <p className="whitespace-pre-line leading-relaxed text-muted-foreground">{s.body}</p>}
        </section>
      );
  }
}

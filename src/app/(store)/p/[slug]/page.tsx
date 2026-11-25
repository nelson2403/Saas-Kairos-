import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImageOff } from "lucide-react";
import { AddToCart } from "@/components/store/add-to-cart";
import { Badge } from "@/components/ui/card";
import { formatMoney } from "@/modules/inventory/domain";
import { productImageUrl } from "@/modules/inventory/images";
import { getStoreProduct, getStoreSettings } from "@/modules/store/data";
import { availabilityLabel } from "@/modules/store/domain";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = SLUG.test(slug) ? await getStoreProduct(slug) : null;
  if (!product) return { title: "Produto não encontrado", robots: { index: false } };
  const description = (product.description ?? `${product.name} na loja Kairós.`).replace(/\s+/g, " ").slice(0, 160);
  const image = product.images[0] ? productImageUrl(product.images[0].path) : undefined;
  return {
    title: product.name,
    description,
    alternates: { canonical: `/p/${product.slug}` },
    openGraph: { type: "website", title: product.name, description, locale: "pt_BR", images: image ? [{ url: image }] : undefined },
  };
}

export default function ProductPage(props: PageProps<"/p/[slug]">) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <Suspense fallback={<div className="aspect-[4/3] animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
        <Product {...props} />
      </Suspense>
    </main>
  );
}

async function Product({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const [product, settings] = await Promise.all([getStoreProduct(slug), getStoreSettings()]);
  if (!product) notFound();
  const availability = availabilityLabel(product.available);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  // Dados estruturados (Google): produto com preço e disponibilidade.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    sku: product.sku ?? undefined,
    image: product.images.map((i) => productImageUrl(i.path)),
    offers: {
      "@type": "Offer",
      price: product.price.toFixed(2),
      priceCurrency: "BRL",
      availability: product.available > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${siteUrl}/p/${product.slug}`,
    },
  };

  return (
    <article className="grid gap-8 md:grid-cols-2 md:gap-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="space-y-3">
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-linho">
          {product.images[0] ? (
            <Image src={productImageUrl(product.images[0].path)} alt={product.images[0].alt ?? product.name} fill priority sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-8" aria-hidden />
            </span>
          )}
        </div>
        {product.images.length > 1 && (
          <ul className="grid grid-cols-4 gap-2">
            {product.images.slice(1, 9).map((img, i) => (
              <li key={img.path} className="relative aspect-square overflow-hidden rounded-md bg-linho">
                <Image src={productImageUrl(img.path)} alt={img.alt ?? `${product.name} — foto ${i + 2}`} fill sizes="120px" className="object-cover" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-5">
        <nav aria-label="Caminho" className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
          <Link href="/produtos" className="hover:text-foreground">
            Produtos
          </Link>
          {product.category && (
            <>
              {" / "}
              <Link href={`/produtos?categoria=${product.category.id}`} className="hover:text-foreground">
                {product.category.name}
              </Link>
            </>
          )}
        </nav>
        <h1 className="font-display text-4xl leading-tight">{product.name}</h1>
        <p className="text-2xl tabular-nums">{formatMoney(product.price)}</p>
        <Badge tone={availability.tone}>{availability.text}</Badge>
        <AddToCart productId={product.id} available={product.available} enabled={settings?.enabled ?? false} />
        {product.description && <div className="whitespace-pre-line border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">{product.description}</div>}
        {settings && (
          <ul className="space-y-1 border-t border-border pt-5 text-sm text-muted-foreground">
            {settings.pickup_enabled && <li>Retirada{settings.pickup_address ? `: ${settings.pickup_address}` : ""}</li>}
            {settings.delivery_enabled && <li>Entrega: {settings.delivery_fee > 0 ? formatMoney(settings.delivery_fee) : "sem taxa"}{settings.delivery_notes ? ` · ${settings.delivery_notes}` : ""}</li>}
          </ul>
        )}
      </div>
    </article>
  );
}

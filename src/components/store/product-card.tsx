import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { formatMoney } from "@/modules/inventory/domain";
import { productImageUrl } from "@/modules/inventory/images";
import type { StoreProductCard } from "@/modules/store/domain";

export function ProductCard({ product, priority = false }: { product: StoreProductCard; priority?: boolean }) {
  const soldOut = product.available <= 0;
  return (
    <Link href={`/p/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-linho">
        {product.image_path ? (
          <Image
            src={productImageUrl(product.image_path)}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`object-cover transition-transform duration-500 group-hover:scale-[1.03] ${soldOut ? "opacity-60" : ""}`}
            priority={priority}
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-6" aria-hidden />
          </span>
        )}
        {soldOut && <span className="absolute left-3 top-3 rounded-full bg-surface/90 px-2.5 py-0.5 text-xs">Esgotado</span>}
      </div>
      <div className="mt-3 space-y-0.5">
        {product.category_name && <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{product.category_name}</p>}
        <h3 className="font-display text-lg leading-snug group-hover:underline">{product.name}</h3>
        <p className="tabular-nums">{formatMoney(product.price)}</p>
      </div>
    </Link>
  );
}

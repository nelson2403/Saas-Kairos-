import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GridSkeleton } from "@/components/store/grid-skeleton";
import { ProductCard } from "@/components/store/product-card";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAGE_SIZE, getStoreCategories, getStoreProducts, getStoreSettings } from "@/modules/store/data";

export const metadata: Metadata = {
  title: "Produtos",
  description: "Todos os produtos da loja virtual Kairós.",
  alternates: { canonical: "/produtos" },
};

export default function CatalogPage({ searchParams }: PageProps<"/produtos">) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
      <h1 className="mb-6 font-display text-4xl">Produtos</h1>
      <Suspense fallback={<GridSkeleton />}>
        <Catalog searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Catalog({ searchParams }: { searchParams: PageProps<"/produtos">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const categoria = typeof sp.categoria === "string" && /^[0-9a-f-]{36}$/.test(sp.categoria) ? sp.categoria : "";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const [settings, categories, { products, total }] = await Promise.all([
    getStoreSettings(),
    getStoreCategories(),
    getStoreProducts({ category: categoria || null, q: q || null, page }),
  ]);
  if (!settings?.enabled) {
    return <p className="text-muted-foreground">A loja não está recebendo pedidos no momento. Volte em breve.</p>;
  }
  const pages = Math.ceil(total / PAGE_SIZE);
  const href = (params: Record<string, string>) => `/produtos?${new URLSearchParams(Object.entries({ q, categoria, ...params }).filter(([, v]) => v))}`;

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <nav aria-label="Categorias" className="flex flex-wrap gap-2">
          <Link href={href({ categoria: "", pagina: "" })} className={`rounded-full border px-4 py-1.5 text-sm ${!categoria ? "border-foreground" : "border-border hover:bg-muted"}`}>
            Todos
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={href({ categoria: c.id, pagina: "" })}
              className={`rounded-full border px-4 py-1.5 text-sm ${categoria === c.id ? "border-foreground" : "border-border hover:bg-muted"}`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
        <form role="search" className="flex gap-2" action="/produtos">
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          <Input name="q" type="search" defaultValue={q} placeholder="Buscar produto" aria-label="Buscar produto" className="md:w-64" />
          <button type="submit" className={buttonVariants({ variant: "secondary" })}>
            Buscar
          </button>
        </form>
      </div>

      {products.length === 0 ? (
        <p className="text-muted-foreground">Nenhum produto encontrado.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm" aria-label="Paginação">
          {page > 1 && (
            <Link href={href({ pagina: String(page - 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Anterior
            </Link>
          )}
          <span className="text-muted-foreground">
            Página {page} de {pages}
          </span>
          {page < pages && (
            <Link href={href({ pagina: String(page + 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Próxima
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

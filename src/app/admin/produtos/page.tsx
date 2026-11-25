import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Image from "next/image";
import { ImageOff, Plus, Tags } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { formatMoney, formatQuantity, marginPercent } from "@/modules/inventory/domain";
import { productImageUrl } from "@/modules/inventory/images";
import { canManageCatalog, categoryPaths, getStockOverview, listCategories, listProducts } from "@/modules/inventory/service";

export const metadata: Metadata = { title: "Produtos" };

const STATUS_LABEL = { active: "Ativo", inactive: "Inativo", archived: "Arquivado" } as const;

export default function ProductsPage({ searchParams }: PageProps<"/admin/produtos">) {
  return (
    <>
      <PageHeader title="Produtos" description="Produtos acabados vendidos pela Kairós.">
        <div className="flex gap-2">
          <Link href="/admin/produtos/categorias" className={buttonVariants({ variant: "outline" })}>
            <Tags aria-hidden /> Categorias
          </Link>
          <Suspense>
            <NewButton />
          </Suspense>
        </div>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <ProductList searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function NewButton() {
  const { role } = await requireMembership();
  if (!canManageCatalog(role)) return null;
  return (
    <Link href="/admin/produtos/novo" className={buttonVariants()}>
      <Plus aria-hidden /> Novo produto
    </Link>
  );
}

async function ProductList({ searchParams }: { searchParams: PageProps<"/admin/produtos">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const category = typeof sp.categoria === "string" ? sp.categoria : "";
  const [products, categories, stock] = await Promise.all([
    listProducts({ q, status: status || undefined, category: category || undefined }),
    listCategories().then(categoryPaths),
    getStockOverview({ type: "product" }),
  ]);
  const balance = new Map(stock.map((s) => [s.item_id, s]));

  return (
    <>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome, SKU ou código de barras" aria-label="Buscar produtos" />
        <Select name="categoria" defaultValue={category} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status} aria-label="Situação">
          <option value="">Ativos e inativos</option>
          <option value="active">Somente ativos</option>
          <option value="inactive">Somente inativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </Select>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Filtrar
        </button>
      </form>

      {products.length === 0 ? (
        <EmptyState title={q || category || status ? "Nenhum produto encontrado com estes filtros." : "Nenhum produto cadastrado ainda."} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Produto</Th>
              <Th>Categoria</Th>
              <Th className="text-right">Preço</Th>
              <Th className="text-right">Margem</Th>
              <Th className="text-right">Estoque</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const b = balance.get(p.id);
              const margin = marginPercent(Number(p.sale_price), p.cost_price == null ? null : Number(p.cost_price));
              return (
                <tr key={p.id} className="hover:bg-muted/40">
                  <Td>
                    <Link href={`/admin/produtos/${p.id}`} className="flex items-center gap-3">
                      <Thumb path={[...p.images].sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path} />
                      <span>
                        <span className="font-medium hover:underline">{p.name}</span>
                        {p.sku && <span className="block text-xs text-muted-foreground">SKU {p.sku}</span>}
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-muted-foreground">{p.category?.name ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.sale_price)}</Td>
                  <Td className="text-right tabular-nums">{margin === null ? "—" : `${margin.toLocaleString("pt-BR")}%`}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {formatQuantity(b?.quantity ?? 0, p.unit.code)}
                    {b?.below_min && (
                      <Badge tone="warning" className="ml-2">
                        Baixo
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={p.status === "active" ? "success" : "neutral"}>{STATUS_LABEL[p.status]}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}

function Thumb({ path }: { path?: string }) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
      {path ? (
        <Image src={productImageUrl(path)} alt="" fill sizes="44px" className="object-cover" />
      ) : (
        <ImageOff className="size-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}

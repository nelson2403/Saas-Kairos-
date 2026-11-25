import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeftRight } from "lucide-react";
import { MovementTable } from "@/components/inventory/movement-table";
import { StockSummary } from "@/components/inventory/stock-summary";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireMembership } from "@/lib/auth/dal";
import {
  canManageCatalog,
  canMoveStock,
  categoryPaths,
  getItemBalance,
  getProduct,
  listCategories,
  listMovements,
  listProductImages,
  listUnits,
} from "@/modules/inventory/service";
import { ProductForm } from "../product-form";
import { ProductPhotos } from "./product-photos";

export const metadata: Metadata = { title: "Produto" };

export default function ProductPage(props: PageProps<"/admin/produtos/[id]">) {
  return (
    <Suspense fallback={<SectionSkeleton lines={4} />}>
      <ProductDetail {...props} />
    </Suspense>
  );
}

async function ProductDetail({ params, searchParams }: PageProps<"/admin/produtos/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { role, companyId } = await requireMembership();
  const [product, categories, units, balance, movements, images] = await Promise.all([
    getProduct(id),
    listCategories().then(categoryPaths),
    listUnits(),
    getItemBalance("product", id),
    listMovements({ itemType: "product", itemId: id }),
    listProductImages(id),
  ]);
  if (!product) notFound();

  return (
    <>
      <PageHeader title={product.name} description={product.sku ? `SKU ${product.sku}` : undefined}>
        {canMoveStock(role) && product.status !== "archived" && (
          <Link href={`/admin/movimentacoes/nova?item=product:${id}`} className={buttonVariants()}>
            <ArrowLeftRight aria-hidden /> Movimentar estoque
          </Link>
        )}
      </PageHeader>
      {sp.criado && (
        <p role="status" className="mb-4 rounded-md bg-success/10 p-3 text-sm text-success">
          Produto cadastrado. Adicione as fotos abaixo e registre o saldo inicial em “Movimentar estoque” (tipo Entrada).
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-3">
          <CardTitle className="mb-4">Fotos</CardTitle>
          <ProductPhotos
            productId={product.id}
            companyId={companyId}
            productName={product.name}
            images={images}
            canEdit={canManageCatalog(role)}
          />
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">Cadastro</CardTitle>
          <ProductForm
            product={product}
            categories={categories}
            units={units}
            canEdit={canManageCatalog(role)}
            unitLocked={movements.total > 0}
          />
        </Card>
        <StockSummary balance={balance} minStock={product.min_stock} />
        <Card className="lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <CardTitle>Movimentações</CardTitle>
            {movements.total > 20 && (
              <Link href={`/admin/movimentacoes?item=product:${id}`} className="text-sm text-muted-foreground hover:text-foreground">
                Ver todas ({movements.total})
              </Link>
            )}
          </div>
          <MovementTable rows={movements.rows.slice(0, 20)} canReverse={canManageCatalog(role)} showItem={false} />
        </Card>
      </div>
    </>
  );
}

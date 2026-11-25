import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { formatCost, formatMoney, formatQuantity, marginPercent } from "@/modules/inventory/domain";
import { listRecipeOverview } from "@/modules/production/service";

export const metadata: Metadata = { title: "Fichas técnicas" };

export default function RecipesPage() {
  return (
    <>
      <PageHeader title="Fichas técnicas" description="O que cada produto consome, quanto rende e quanto custa com os custos atuais dos insumos.">
        <Link href="/admin/producao" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden /> Produção
        </Link>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <Overview />
        </Suspense>
      </Card>
    </>
  );
}

async function Overview() {
  const rows = await listRecipeOverview();
  if (!rows.length) {
    return (
      <EmptyState title="Nenhum produto cadastrado.">
        Cadastre os produtos em <Link href="/admin/produtos" className="underline">Produtos</Link> e depois monte a ficha técnica de cada um.
      </EmptyState>
    );
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Produto</Th>
          <Th>Ficha</Th>
          <Th className="text-right">Custo estimado</Th>
          <Th className="text-right">Preço</Th>
          <Th className="text-right">Margem</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ product, recipe, estimate }) => {
          const incomplete = !!estimate && (estimate.missingCost.length > 0 || estimate.invalid.length > 0);
          const margin = estimate && !incomplete ? marginPercent(Number(product.sale_price), estimate.unitCost) : null;
          return (
            <tr key={product.id} className="hover:bg-muted/40">
              <Td>
                <Link href={`/admin/producao/fichas/${product.id}`} className="font-medium hover:underline">
                  {product.name}
                </Link>
                {product.sku && <span className="block text-xs text-muted-foreground">SKU {product.sku}</span>}
              </Td>
              <Td>
                {recipe ? (
                  <span className="text-sm">
                    v{recipe.version} · {recipe.items} {recipe.items === 1 ? "insumo" : "insumos"} · rende {formatQuantity(recipe.yield_quantity, product.unit.code)}
                  </span>
                ) : (
                  <Badge>Sem ficha</Badge>
                )}
              </Td>
              <Td className="whitespace-nowrap text-right tabular-nums">
                {estimate ? formatCost(estimate.unitCost) : "—"}
                {incomplete && <span className="block text-xs text-warning">insumo sem custo</span>}
              </Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{formatMoney(product.sale_price)}</Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{margin == null ? "—" : `${margin.toLocaleString("pt-BR")}%`}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { PageHeader, SectionSkeleton } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Table, Td, Th } from "@/components/ui/table";
import { requireMembership } from "@/lib/auth/dal";
import { formatDocument } from "@/lib/validations/document";
import { formatPhone } from "@/modules/partners/domain";
import { canEditSuppliers, listSuppliers } from "@/modules/partners/service";

export const metadata: Metadata = { title: "Fornecedores" };

export default function SuppliersPage({ searchParams }: PageProps<"/admin/fornecedores">) {
  return (
    <>
      <PageHeader title="Fornecedores" description="Quem fornece matérias-primas e mercadorias.">
        <Suspense>
          <NewButton />
        </Suspense>
      </PageHeader>
      <Card>
        <Suspense fallback={<SectionSkeleton />}>
          <List searchParams={searchParams} />
        </Suspense>
      </Card>
    </>
  );
}

async function NewButton() {
  const { role } = await requireMembership();
  if (!canEditSuppliers(role)) return null;
  return (
    <Link href="/admin/fornecedores/novo" className={buttonVariants()}>
      <Plus aria-hidden /> Novo fornecedor
    </Link>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/admin/fornecedores">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const rows = await listSuppliers({ q, status });
  return (
    <>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome ou CNPJ" aria-label="Buscar fornecedores" />
        <Select name="status" defaultValue={status} aria-label="Situação">
          <option value="">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="all">Todos</option>
        </Select>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Buscar
        </button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={q ? "Nenhum fornecedor encontrado." : "Nenhum fornecedor cadastrado ainda."} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fornecedor</Th>
              <Th>Contato</Th>
              <Th>Cidade</Th>
              <Th>Situação</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-muted/40">
                <Td>
                  <Link href={`/admin/fornecedores/${s.id}`} className="font-medium hover:underline">
                    {s.trade_name || s.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {s.trade_name ? s.name : ""}
                    {s.document ? `${s.trade_name ? " · " : ""}${formatDocument(s.document)}` : ""}
                  </span>
                </Td>
                <Td className="text-sm">
                  {s.contact_name && <span className="block">{s.contact_name}</span>}
                  {s.phone && <span className="block whitespace-nowrap text-muted-foreground">{formatPhone(s.phone)}</span>}
                  {s.email && <span className="block text-muted-foreground">{s.email}</span>}
                </Td>
                <Td className="text-muted-foreground">{[s.city, s.state].filter(Boolean).join("/") || "—"}</Td>
                <Td>
                  <Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status === "active" ? "Ativo" : "Inativo"}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

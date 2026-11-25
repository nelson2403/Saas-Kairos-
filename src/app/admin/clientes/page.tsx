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
import { formatPhone, maskDocument } from "@/modules/partners/domain";
import { PARTNERS_PAGE_SIZE, canEditCustomers, listCustomers } from "@/modules/partners/service";

export const metadata: Metadata = { title: "Clientes" };

export default function CustomersPage({ searchParams }: PageProps<"/admin/clientes">) {
  return (
    <>
      <PageHeader title="Clientes" description="Cadastro e consentimentos de contato (LGPD).">
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
  if (!canEditCustomers(role)) return null;
  return (
    <Link href="/admin/clientes/novo" className={buttonVariants()}>
      <Plus aria-hidden /> Novo cliente
    </Link>
  );
}

async function List({ searchParams }: { searchParams: PageProps<"/admin/clientes">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const { rows, total } = await listCustomers({ q, status, page });
  const pages = Math.ceil(total / PARTNERS_PAGE_SIZE);
  const href = (p: number) => `/admin/clientes?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(p > 1 && { pagina: String(p) }) })}`;

  return (
    <>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome, e-mail, telefone ou CPF" aria-label="Buscar clientes" />
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
        <EmptyState title={q ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Contato</Th>
              <Th>Cidade</Th>
              <Th>Consentimentos</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-muted/40">
                <Td>
                  <Link href={`/admin/clientes/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.document && <span className="block text-xs text-muted-foreground">{maskDocument(c.document)}</span>}
                  {c.anonymized_at && <Badge className="mt-1">Anonimizado</Badge>}
                </Td>
                <Td className="text-sm">
                  {c.phone && <span className="block whitespace-nowrap">{formatPhone(c.phone)}</span>}
                  {c.email && <span className="block text-muted-foreground">{c.email}</span>}
                </Td>
                <Td className="text-muted-foreground">{[c.city, c.state].filter(Boolean).join("/") || "—"}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {c.whatsapp_opt_in && <Badge tone="success">WhatsApp</Badge>}
                    {c.marketing_opt_in && <Badge tone="success">Marketing</Badge>}
                    {!c.whatsapp_opt_in && !c.marketing_opt_in && <span className="text-xs text-muted-foreground">Nenhum</span>}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
          <span className="text-muted-foreground">
            Página {page} de {pages} · {total} clientes
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Anterior
              </Link>
            )}
            {page < pages && (
              <Link href={href(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Próxima
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}

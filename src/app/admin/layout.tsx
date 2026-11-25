import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BottomNav, Sidebar } from "@/components/layout/admin-nav";
import { LogoutButton } from "@/components/layout/logout-button";
import { ConnectionPill } from "@/components/pwa/connection-status";
import { SyncManager } from "@/components/pwa/sync-manager";
import { Logo } from "@/components/brand/logo";
import { requireMembership } from "@/lib/auth/dal";

export const metadata: Metadata = { title: { default: "Painel", template: "%s · Kairós" }, robots: { index: false } };

/**
 * A estrutura (menu, barra superior, navegação inferior) é estática e entra no
 * App Shell pré-renderizado — é o que abre instantaneamente e offline.
 * Somente os dados do usuário aguardam a requisição, dentro de <Suspense>.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh md:flex">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 print:hidden border-b border-border bg-background/90 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 md:h-16 md:px-8">
            <Link href="/admin" className="md:hidden" aria-label="Kairós — início">
              <Logo className="[&>span]:text-lg" />
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <ConnectionPill />
              <Suspense fallback={<span className="h-9 w-24 animate-pulse rounded-md bg-muted" />}>
                <UserMenu />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="flex-1 print:p-0 px-4 pb-[calc(6rem+var(--safe-bottom))] pt-6 md:px-8 md:pb-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}

async function UserMenu() {
  const { user, companyName } = await requireMembership();
  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-sm font-medium">{user.fullName ?? user.email}</p>
        <p className="text-xs text-muted-foreground">{companyName}</p>
      </div>
      <LogoutButton userId={user.id} compact />
      <SyncManager userId={user.id} />
    </div>
  );
}

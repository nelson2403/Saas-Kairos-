import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { CartButton } from "@/components/store/cart-button";
import { getStoreSettings } from "@/modules/store/data";
import { whatsappLink } from "@/modules/store/domain";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:h-20 md:px-6">
          <Link href="/" aria-label="Kairós — página inicial">
            <Logo className="[&>span:first-child]:text-xl md:[&>span:first-child]:text-2xl" />
          </Link>
          <nav aria-label="Loja" className="ml-auto flex items-center gap-1 text-sm">
            <Link href="/produtos" className="rounded-md px-3 py-2 hover:bg-muted">
              Produtos
            </Link>
            <CartButton />
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="pb-safe mt-16 border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-muted-foreground md:grid-cols-3 md:px-6">
          <div>
            <Logo withTagline className="items-start" />
          </div>
          <Suspense>
            <FooterContact />
          </Suspense>
          <ul className="space-y-2 md:text-right">
            <li>
              <Link href="/privacidade" className="hover:text-foreground">
                Política de privacidade
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-foreground">
                Acesso da equipe
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

async function FooterContact() {
  const s = await getStoreSettings();
  const wa = whatsappLink(s?.whatsapp, "Olá! Vim pela loja virtual.");
  return (
    <div className="space-y-1">
      {s?.company_name && <p className="text-foreground">{s.company_name}</p>}
      {s?.pickup_enabled && s.pickup_address && <p>{s.pickup_address}</p>}
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          Fale conosco no WhatsApp
        </a>
      )}
    </div>
  );
}

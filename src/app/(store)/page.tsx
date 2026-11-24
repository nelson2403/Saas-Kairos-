import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/**
 * Loja virtual pública: entregue na Fase 6 (catálogo, carrinho, checkout) e
 * personalizável na Fase 7. Até lá, apenas a apresentação da marca.
 */
export default function StoreHome() {
  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center gap-10 px-6 text-center">
      <Logo withTagline className="[&>span:first-child]:text-4xl md:[&>span:first-child]:text-5xl" />
      <p className="max-w-md text-sm text-muted-foreground">Nossa loja online está sendo preparada com cuidado. Em breve.</p>
      <Link href="/login" className="text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground">
        Acesso da equipe
      </Link>
    </main>
  );
}

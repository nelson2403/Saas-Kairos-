import { cn } from "@/lib/utils/cn";

/**
 * Assinatura tipográfica PROVISÓRIA. Quando a logo oficial for entregue,
 * substituir o conteúdo deste componente por <Image src="/brand/logo.svg" …/>
 * sem alterar proporção ou símbolo (ver docs/BRAND.md).
 */
export function Logo({ className, withTagline = false }: { className?: string; withTagline?: boolean }) {
  return (
    <span className={cn("inline-flex flex-col items-center leading-none", className)}>
      <span className="font-display text-2xl tracking-brand text-foreground">KAIRÓS</span>
      {withTagline && (
        <span className="mt-2 text-[0.625rem] uppercase tracking-[0.28em] text-muted-foreground">
          Onde o agora se torna abrigo
        </span>
      )}
    </span>
  );
}

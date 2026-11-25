import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { CartButton } from "@/components/store/cart-button";
import { storeFontVariables } from "@/components/store/fonts";
import type { StoreSettings } from "@/modules/store/domain";
import { whatsappLink } from "@/modules/store/domain";
import { storeAssetUrl } from "@/modules/storefront/assets";
import type { Storefront } from "@/modules/storefront/schema";

const FONT_VAR = { cormorant: "var(--font-display-serif)", playfair: "var(--font-playfair)", lora: "var(--font-lora)" } as const;
const RADIUS_VARS = {
  reto: { sm: "0px", md: "0px", lg: "0px", xl: "0px" },
  suave: { sm: "0.375rem", md: "0.625rem", lg: "0.875rem", xl: "1.25rem" },
  redondo: { sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
} as const;

/**
 * Variáveis de cor/fonte/cantos da loja. As cores já foram validadas como
 * #RRGGBB pelo esquema, então não há como injetar CSS por aqui.
 */
export function themeStyle(theme: Storefront["theme"]): React.CSSProperties {
  const mix = (pct: number) => `color-mix(in srgb, ${theme.text} ${pct}%, ${theme.background})`;
  const r = RADIUS_VARS[theme.radius];
  return {
    "--color-background": theme.background,
    "--color-surface": theme.surface,
    "--color-foreground": theme.text,
    "--color-muted-foreground": theme.muted_text,
    "--color-muted": mix(8),
    "--color-linho": mix(8),
    "--color-border": mix(14),
    "--color-accent": mix(18),
    "--color-ring": theme.muted_text,
    "--color-primary": theme.accent,
    "--color-primary-foreground": theme.accent_text,
    "--color-tinta": theme.accent,
    "--color-marfim": theme.accent_text,
    "--font-display": FONT_VAR[theme.display_font],
    "--radius-sm": r.sm,
    "--radius-md": r.md,
    "--radius-lg": r.lg,
    "--radius-xl": r.xl,
  } as React.CSSProperties;
}

export function StoreLogo({ config, size = "md" }: { config: Storefront; size?: "md" | "lg" }) {
  if (config.brand.logo_path) {
    return (
      <Image
        src={storeAssetUrl(config.brand.logo_path)}
        alt="Kairós"
        width={size === "lg" ? 320 : 160}
        height={size === "lg" ? 120 : 48}
        className={size === "lg" ? "h-24 w-auto object-contain md:h-28" : "h-9 w-auto object-contain md:h-11"}
        priority
      />
    );
  }
  return (
    <Logo
      withTagline={size === "lg" && config.brand.show_tagline}
      className={size === "lg" ? "[&>span:first-child]:text-5xl md:[&>span:first-child]:text-6xl" : "[&>span:first-child]:text-xl md:[&>span:first-child]:text-2xl"}
    />
  );
}

/** Cabeçalho, barra de aviso e rodapé da loja, com o tema aplicado. */
export function StorefrontChrome({
  config,
  settings,
  children,
  preview = false,
}: {
  config: Storefront;
  settings: StoreSettings | null;
  children: React.ReactNode;
  preview?: boolean;
}) {
  const wa = config.footer.show_whatsapp ? whatsappLink(settings?.whatsapp, "Olá! Vim pela loja virtual.") : null;
  const announcement = config.announcement.enabled && config.announcement.text;
  return (
    <div style={themeStyle(config.theme)} className={`${storeFontVariables} flex min-h-dvh flex-col bg-background text-foreground`}>
      {preview && (
        <div className="bg-warning px-4 py-1.5 text-center text-xs text-white">Prévia do rascunho — clientes ainda veem a versão publicada</div>
      )}
      {announcement && (
        <div className="bg-primary px-4 py-2 text-center text-sm text-primary-foreground">
          {config.announcement.link ? (
            <Link href={config.announcement.link} className="underline-offset-4 hover:underline">
              {config.announcement.text}
            </Link>
          ) : (
            config.announcement.text
          )}
        </div>
      )}
      <header className="pt-safe sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:h-20 md:px-6">
          <Link href="/" aria-label="Página inicial">
            <StoreLogo config={config} />
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
          <div className="space-y-3">
            <StoreLogo config={config} />
            {config.footer.about && <p className="max-w-xs whitespace-pre-line">{config.footer.about}</p>}
          </div>
          <div className="space-y-1">
            {settings?.company_name && <p className="text-foreground">{settings.company_name}</p>}
            {settings?.pickup_enabled && settings.pickup_address && <p>{settings.pickup_address}</p>}
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="block underline hover:text-foreground">
                Fale conosco no WhatsApp
              </a>
            )}
            {config.footer.instagram && (
              <a href={config.footer.instagram} target="_blank" rel="noopener noreferrer" className="block underline hover:text-foreground">
                Instagram
              </a>
            )}
          </div>
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

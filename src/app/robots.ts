import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/login", "/onboarding", "/offline", "/api", "/carrinho", "/checkout", "/pedido", "/previa"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}

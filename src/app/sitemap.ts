import type { MetadataRoute } from "next";
import { getAllStoreSlugs } from "@/modules/store/data";

/** Mapa do site da loja (páginas públicas e produtos visíveis). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const products = await getAllStoreSlugs().catch(() => []);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/produtos`, changeFrequency: "daily", priority: 0.9 },
    ...products.map((p) => ({ url: `${base}/p/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
    { url: `${base}/privacidade`, changeFrequency: "yearly", priority: 0.2 },
  ];
}

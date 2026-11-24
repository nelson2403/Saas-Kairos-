import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/admin",
    name: "SAS Kairós",
    short_name: "Kairós",
    description: "Gestão Kairós — estoque, produção, pedidos e loja. Onde o agora se torna abrigo.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#F7F4EF",
    theme_color: "#F7F4EF",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Estoque", url: "/admin/estoque", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Pedidos", url: "/admin/pedidos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

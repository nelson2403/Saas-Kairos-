#!/usr/bin/env node
/**
 * Gera os ícones do PWA a partir de um SVG/PNG da marca.
 *   node scripts/generate-icons.mjs [caminho-da-logo]
 * Padrão: public/brand/logo.svg se existir; senão o monograma provisório.
 *
 * Ícones "maskable" recebem margem de segurança (80% de área útil) sobre o
 * Marfim de Cera, para não cortar a marca em launchers com máscara circular.
 */
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const official = join(root, "public", "brand", "logo.svg");
const fallback = join(root, "public", "brand", "monogram-provisorio.svg");
const source = process.argv[2] ?? (existsSync(official) ? official : fallback);
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const MARFIM = { r: 247, g: 244, b: 239, alpha: 1 };

async function plain(size, name) {
  await sharp(source, { density: 384 })
    .resize(size, size, { fit: "contain", background: MARFIM })
    .flatten({ background: MARFIM })
    .png()
    .toFile(join(out, name));
}

async function maskable(size, name) {
  const inner = Math.round(size * 0.8);
  const art = await sharp(source, { density: 384 })
    .resize(inner, inner, { fit: "contain", background: MARFIM })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: MARFIM } })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toFile(join(out, name));
}

await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
await maskable(192, "icon-maskable-192.png");
await maskable(512, "icon-maskable-512.png");
await plain(180, "apple-touch-icon.png");
await plain(32, "favicon-32.png");
await plain(96, "badge-96.png");

console.log(`Ícones gerados em public/icons a partir de ${source}`);

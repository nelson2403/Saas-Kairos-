import { Lora, Playfair_Display } from "next/font/google";

/** Fontes de título disponíveis no editor (Cormorant já vem do layout raiz). */
export const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
export const lora = Lora({ variable: "--font-lora", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const storeFontVariables = `${playfair.variable} ${lora.variable}`;

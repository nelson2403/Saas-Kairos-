"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Abre a impressão do navegador (inclui "Salvar como PDF"). */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer aria-hidden /> Imprimir / PDF
    </Button>
  );
}

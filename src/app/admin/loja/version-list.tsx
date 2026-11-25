"use client";

import { useState, useTransition } from "react";
import { History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import type { StorefrontVersion } from "@/modules/storefront/service";
import { restoreVersionAction } from "./actions";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function VersionList({
  versions,
  people,
  current,
  canEdit,
}: {
  versions: StorefrontVersion[];
  people: Record<string, string>;
  current: number | null;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (!versions.length) return <p className="text-sm text-muted-foreground">Nada publicado ainda. A loja usa a aparência padrão até a primeira publicação.</p>;

  function restore(v: number) {
    if (!confirm(`Copiar a versão ${v} para o rascunho? O rascunho atual será substituído (a loja publicada não muda).`)) return;
    setBusy(v);
    start(async () => {
      const r = await restoreVersionAction(v);
      setFeedback({ ok: r.ok, text: r.ok ? (r.message ?? "") : (r.error ?? "Não foi possível restaurar.") });
      setBusy(null);
      // recarrega o editor com o rascunho restaurado
      if (r.ok) window.location.reload();
    });
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="font-medium">Versão {v.version}</span>
            {v.version === current && <Badge tone="success">No ar</Badge>}
            <span className="text-muted-foreground">
              {dateTime.format(new Date(v.published_at))}
              {v.published_by && people[v.published_by] ? ` · ${people[v.published_by]}` : ""}
              {v.note ? ` · ${v.note}` : ""}
            </span>
            {canEdit && (
              <Button variant="ghost" size="sm" className="ml-auto" disabled={pending} onClick={() => restore(v.version)}>
                {busy === v.version ? <Loader2 className="animate-spin" aria-hidden /> : <History aria-hidden />}
                Restaurar no rascunho
              </Button>
            )}
          </li>
        ))}
      </ul>
      {feedback && !feedback.ok && <FieldError message={feedback.text} />}
    </>
  );
}

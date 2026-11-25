"use client";

import { useSyncExternalStore } from "react";
import { isScheduledNow } from "@/modules/storefront/schema";

const noop = () => () => {};

/**
 * Mostra o conteúdo só dentro do período agendado. A conferência é feita no
 * navegador (a página é pré-renderizada e fica em cache); sem agenda, aparece sempre.
 */
export function Scheduled({ startsAt, endsAt, children }: { startsAt: string | null; endsAt: string | null; children: React.ReactNode }) {
  const scheduled = !!(startsAt || endsAt);
  const visible = useSyncExternalStore(
    noop,
    () => !scheduled || isScheduledNow(startsAt, endsAt, new Date()),
    () => !scheduled,
  );
  return visible ? <>{children}</> : null;
}

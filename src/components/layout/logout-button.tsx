"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { clearPrivateCaches } from "@/components/pwa/service-worker";
import { clearUserData } from "@/lib/offline/queue";
import { Button } from "@/components/ui/button";

export function LogoutButton({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      disabled={pending}
      aria-label="Sair"
      onClick={() =>
        startTransition(async () => {
          clearPrivateCaches();
          await clearUserData(userId).catch(() => {});
          await signOut();
        })
      }
    >
      <LogOut aria-hidden />
      {!compact && "Sair"}
    </Button>
  );
}

import { cn } from "@/lib/utils/cn";

/** Tabela com rolagem horizontal no celular. */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className={cn("w-full min-w-[36rem] border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("border-b border-border px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-b border-border/60 px-3 py-3 align-middle", className)} {...props} />;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { monthRange } from "@/modules/finance/domain";

/** Filtro de período por URL (?de=&ate=), funciona sem JavaScript. Atalhos para os meses. */
export function PeriodFilter({
  action,
  from,
  to,
  today,
  hidden = {},
}: {
  action: string;
  from: string;
  to: string;
  today: string;
  hidden?: Record<string, string>;
}) {
  const current = monthRange(today);
  const prevDay = new Date(Date.parse(current.from) - 86_400_000).toISOString().slice(0, 10);
  const previous = monthRange(prevDay);
  const qs = (f: string, t: string) => `${action}?${new URLSearchParams({ ...hidden, de: f, ate: t })}`;
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
      <form className="flex flex-wrap items-end gap-2" action={action}>
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">De</span>
          <Input type="date" name="de" defaultValue={from} className="w-40" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Até</span>
          <Input type="date" name="ate" defaultValue={to} className="w-40" />
        </label>
        <button type="submit" className={buttonVariants({ variant: "secondary" })}>
          Aplicar
        </button>
      </form>
      <Link href={qs(current.from, current.to)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Este mês
      </Link>
      <Link href={qs(previous.from, previous.to)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Mês passado
      </Link>
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "success" }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl tabular-nums ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

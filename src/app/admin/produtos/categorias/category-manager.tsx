"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/table";
import type { ActionResult } from "@/lib/action-result";
import { deleteCategoryAction, saveCategoryAction } from "../actions";

type Cat = { id: string; name: string; parent_id: string | null; path: string };

function CategoryForm({ category, categories, onDone }: { category: Cat | null; categories: Cat[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await saveCategoryAction(category?.id ?? null, prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <Input name="name" defaultValue={category?.name} placeholder="Nome da categoria" required maxLength={80} aria-label="Nome" />
      <Select name="parent_id" defaultValue={category?.parent_id ?? ""} aria-label="Categoria-mãe">
        <option value="">Sem categoria-mãe</option>
        {categories
          .filter((c) => c.id !== category?.id)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
      </Select>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {category ? "Salvar" : "Adicionar"}
      </Button>
      <div className="sm:col-span-3">
        <FieldError message={errors.name ?? errors.parent_id ?? (state && !state.ok ? state.error : undefined)} />
        {state?.ok && !category && (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

export function CategoryManager({ categories, canEdit }: { categories: Cat[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  return (
    <div className="space-y-6">
      {canEdit && <CategoryForm category={null} categories={categories} />}
      {error && <FieldError message={error} />}
      {categories.length === 0 ? (
        <EmptyState title="Nenhuma categoria cadastrada." />
      ) : (
        <ul className="divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id} className="py-3">
              {editing === c.id ? (
                <CategoryForm category={c} categories={categories} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{c.path}</span>
                  {canEdit && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c.id)} aria-label={`Editar ${c.name}`}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting}
                        aria-label={`Excluir ${c.name}`}
                        onClick={() => {
                          if (!confirm(`Excluir a categoria "${c.name}"? Os produtos dela ficarão sem categoria.`)) return;
                          startDelete(async () => {
                            const r = await deleteCategoryAction(c.id);
                            setError(r.ok ? null : (r.error ?? "Não foi possível excluir."));
                          });
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

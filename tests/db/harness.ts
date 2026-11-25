/**
 * Banco de teste: PostgreSQL real (PGlite/WASM) com um "stub" mínimo do que o
 * Supabase provê (schema auth, auth.uid(), papéis anon/authenticated/service_role
 * e privilégios padrão). As migrations reais de supabase/migrations são aplicadas
 * em ordem, então RLS e funções são exercitadas de verdade.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

/** Migrations em ordem: [nome do arquivo, SQL]. */
export function readMigrations(): [string, string][] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => [f, readFileSync(join(MIGRATIONS_DIR, f), "utf8")]);
}

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const [file, sql] of readMigrations()) {
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Falha na migration ${file}: ${(error as Error).message}`);
    }
  }
  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createUser(db: TestDb, email: string, fullName?: string) {
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(fullName ? { full_name: fullName } : {})],
  );
  return res.rows[0].id;
}

/**
 * Executa `fn` como se fosse uma requisição da API do Supabase:
 * papel `authenticated` (ou `anon`) com o JWT do usuário. Sempre desfaz
 * a transação no fim, a menos que `commit` seja true.
 */
export async function asRole<T>(
  db: TestDb,
  role: "anon" | "authenticated",
  userId: string | null,
  fn: (tx: TestDb) => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    await db.exec(`set local role ${role}`);
    const result = await fn(db);
    await db.exec(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

export const asUser = <T>(
  db: TestDb,
  userId: string,
  fn: (tx: TestDb) => Promise<T>,
  opts?: { commit?: boolean },
) => asRole(db, "authenticated", userId, fn, opts);

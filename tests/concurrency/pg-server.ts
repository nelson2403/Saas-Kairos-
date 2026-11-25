/**
 * PostgreSQL 17 embutido (processo real, várias conexões simultâneas) com o
 * stub do Supabase e todas as migrations aplicadas. Cada arquivo de teste sobe
 * o seu próprio servidor em porta aleatória.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { SUPABASE_STUB, readMigrations } from "../db/harness";

export async function startPg() {
  const port = 54000 + Math.floor(Math.random() * 900);
  const dataDir = mkdtempSync(join(tmpdir(), "kairos-pg-"));
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"], // igual ao Supabase (no Windows o padrão seria WIN1252)
    onLog: () => {},
    onError: () => {},
  });
  const config = { host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "kairos" };

  await server.initialise();
  await server.start();
  await server.createDatabase("kairos");
  const admin = new pg.Client(config);
  await admin.connect();
  await admin.query(SUPABASE_STUB);
  for (const [file, sql] of readMigrations()) {
    try {
      await admin.query(sql);
    } catch (e) {
      throw new Error(`Falha na migration ${file}: ${(e as Error).message}`);
    }
  }

  /** Uma conexão nova por chamada, como requisições independentes da API. */
  async function asUserConn<T>(userId: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = new pg.Client(config);
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
      await c.query("set local role authenticated");
      const out = await fn(c);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      await c.end();
    }
  }

  async function stop() {
    await admin.end();
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }

  return { admin, asUserConn, stop };
}

import { createClient, type Client, type InValue, type ResultSet } from '@libsql/client';

type DatabaseEnvironment = {
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

const setupError = () => new Error('Database is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN on the server.');

/** Server-only connection factory. Never silently fall back to an ephemeral local database. */
export function createDatabaseFromEnvironment(environment: DatabaseEnvironment): D1Database {
  const url = environment.TURSO_DATABASE_URL?.trim();
  const authToken = environment.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) throw setupError();
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw setupError(); }
  if (!['libsql:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw setupError();
  }
  return createDatabase(createClient({ url, authToken, intMode: 'number' }));
}

function binding(value: unknown): InValue {
  if (value === null || typeof value === 'string' || typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  throw new TypeError('Unsupported SQL parameter. Use text, a finite number, binary data, or null.');
}

function plainRows<T>(result: ResultSet): T[] {
  // libSQL rows also expose numeric keys; D1 returns only column names.
  return result.rows.map(row => Object.fromEntries(result.columns.map((name, index) => [name, row[index]])) as T);
}

function d1Result<T>(result: ResultSet, started: number): D1Result<T> {
  return {
    success: true,
    results: plainRows<T>(result),
    meta: {
      changes: result.rowsAffected,
      last_row_id: Number(result.lastInsertRowid ?? 0),
      changed_db: result.rowsAffected > 0,
      // These compatibility fields are not used by Weft. libSQL does not expose D1 page metrics.
      duration: Math.max(0, performance.now() - started),
      size_after: 0,
      rows_read: result.rows.length,
      rows_written: result.rowsAffected,
    },
  };
}

class PreparedStatement implements D1PreparedStatement {
  constructor(readonly owner: Client, readonly sql: string, readonly args: InValue[] = []) {}

  bind(...values: unknown[]): PreparedStatement {
    return new PreparedStatement(this.owner, this.sql, values.map(binding));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.owner.execute({ sql: this.sql, args: this.args });
    if (!result.rows.length) return null;
    if (column !== undefined) {
      const index = result.columns.indexOf(column);
      if (index < 0) throw new Error('The requested SQL result column does not exist.');
      return result.rows[0][index] as T;
    }
    return plainRows<T>(result)[0];
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const started = performance.now();
    return d1Result<T>(await this.owner.execute({ sql: this.sql, args: this.args }), started);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.all<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const result = await this.owner.execute({ sql: this.sql, args: this.args });
    const rows = result.rows.map(row => result.columns.map((_, index) => row[index]) as T);
    return options?.columnNames ? [result.columns, ...rows] : rows;
  }
}

/** The D1 subset used by Weft, backed by durable libSQL storage. */
export function createDatabase(client: Client): D1Database {
  return {
    prepare(sql: string) { return new PreparedStatement(client, sql); },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const queries = statements.map(statement => {
        if (!(statement instanceof PreparedStatement) || statement.owner !== client) {
          throw new TypeError('A SQL batch must use statements prepared by the same database.');
        }
        return { sql: statement.sql, args: statement.args };
      });
      if (!queries.length) return [];
      const started = performance.now();
      // Explicit write mode is an atomic BEGIN IMMEDIATE transaction, including reads.
      return (await client.batch(queries, 'write')).map(result => d1Result<T>(result, started));
    },
    async exec() { throw new Error('Use prepared statements or the explicit migration command.'); },
    withSession() { throw new Error('D1 session bookmarks are not supported by the Vercel database adapter.'); },
    async dump() { throw new Error('Use the database provider backup/export tools.'); },
  };
}

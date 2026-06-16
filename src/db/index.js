import pg from 'pg';

const { Pool } = pg;

// SSL preference: Supabase (and most hosted PG) support it. Some networks
// (corporate proxies / ISPs) intercept port 5432 and refuse the SSL handshake,
// which makes pg throw "The server does not support SSL connections". In that
// case we transparently fall back to a non-SSL connection (the Supabase pooler
// accepts both). Set PGSSL=false to force non-SSL from the start.
const preferSsl = (process.env.PGSSL ?? 'true').toLowerCase() !== 'false';

const buildPool = (ssl) =>
  new Pool({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 12_000,
    keepAlive: true, // avoid cold-socket reconnect latency between queries
  });

// `let` + ESM live bindings: if we rebuild the pool below, every importer of
// `pool` / `query` / `withTransaction` automatically uses the new one.
let pool = buildPool(preferSsl);
const attach = (p) => p.on('error', (err) => console.error('Unexpected idle pg client error:', err));
attach(pool);

const isSslUnsupported = (err) =>
  /does not support SSL/i.test(err?.message || '');

/** Run a single parameterized query. */
export const query = (text, params) => pool.query(text, params);

/** Run a function inside a transaction (commits on success, rolls back on throw). */
export const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/** Verify connectivity at boot; falls back to non-SSL if SSL is refused. */
export const connectToDb = async () => {
  try {
    const res = await pool.query('SELECT NOW() AS now');
    console.log(`✅ Postgres connected${preferSsl ? ' (SSL)' : ''} at`, res.rows[0].now);
    return pool;
  } catch (err) {
    if (preferSsl && isSslUnsupported(err)) {
      console.warn('⚠️  SSL was refused by the network path — retrying without SSL…');
      await pool.end().catch(() => {});
      pool = buildPool(false);
      attach(pool);
      const res = await pool.query('SELECT NOW() AS now');
      console.log('✅ Postgres connected (no SSL fallback) at', res.rows[0].now);
      return pool;
    }
    throw err;
  }
};

export { pool };
export default connectToDb;

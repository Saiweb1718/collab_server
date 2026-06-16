import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import after dotenv so the pool sees the connection string.
const db = await import('../db/index.js');

async function runMigration() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  try {
    // Connects (and transparently falls back to non-SSL if the network refuses SSL).
    await db.connectToDb();
    // schema.sql is one idempotent script (DO $$ blocks / functions / triggers),
    // so run it as a single statement rather than naively splitting on ';'.
    await db.query(sql);
    console.log('✅ Schema migration completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

runMigration();

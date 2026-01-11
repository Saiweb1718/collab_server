import fs from 'fs'
import path from 'path'

import { supabase } from '../utils/supabase.js'

async function runMigration() {
    try {
        const sqlPath = path.join("../models", 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const statements = sql.split(';').filter(stmt => stmt.trim());
    for (const stmt of statements) {
      const { error } = await supabase.rpc('execute', { sql: stmt + ';' });
      if (error) {
        console.error('Migration error:', error);
        throw error;
      }
    }
    console.log('Schema migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', err);
    }
}
export  {runMigration};
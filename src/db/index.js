import { Client } from 'pg';

async function connectToDb() {
  const client = new Client({
    connectionString: 'postgresql://postgres:WeGotThis%40123@db.ecufzbtznsrpghyoilyh.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query('SELECT NOW()'); 
    console.log(res.rows[0]);
    console.log("Db is connected");
    
  } catch (err) {
    console.error('Connection error:', err);
  } finally {
    await client.end();
  }
}

export default connectToDb;
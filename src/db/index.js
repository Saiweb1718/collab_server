import { Client } from 'pg';

async function connectToDb() {
  const client = new Client({
    connectionString: process.env.SUPABASE_CONNECTION_STRING,
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
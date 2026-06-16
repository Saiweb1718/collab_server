import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Read env LAZILY (inside functions), never at module-load time — otherwise the
// values get frozen to whatever process.env held the instant this file was first
// imported, which may be before dotenv has run.
const cfg = () => ({
  url: process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  key:
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_BUCKET || 'uploads',
});

export const isStorageConfigured = () => {
  const { url, key } = cfg();
  return Boolean(url && key);
};

let client = null;
let bucketReady = false;

const getClient = () => {
  const { url, key } = cfg();
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false } });
  return client;
};

// Make sure the (public) bucket exists. Public = unguessable UUID paths are
// shareable via URL; swap to a private bucket + signed URLs for stricter needs.
const ensureBucket = async (sb, bucket) => {
  if (bucketReady) return;
  const { data } = await sb.storage.getBucket(bucket);
  if (!data) {
    await sb.storage.createBucket(bucket, { public: true, fileSizeLimit: '25MB' });
  }
  bucketReady = true;
};

/**
 * Upload a file buffer and return its public URL + metadata.
 * @param {{ buffer: Buffer, mimetype: string, originalname: string, size?: number }} file
 * @param {string} folder logical folder, e.g. 'chat' or 'avatars'
 */
export const uploadFile = async (file, folder = 'chat') => {
  const { bucket } = cfg();
  const sb = getClient();
  if (!sb) {
    const err = new Error('File storage is not configured on the server');
    err.statusCode = 503;
    throw err;
  }
  await ensureBucket(sb, bucket);

  const safeName = (file.originalname || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${folder}/${randomUUID()}-${safeName}`;

  const { error } = await sb.storage
    .from(bucket)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw new Error(error.message);

  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  const kind = file.mimetype?.startsWith('image/') ? 'image' : 'file';
  return { url: data.publicUrl, path, type: kind, name: file.originalname, size: file.size };
};

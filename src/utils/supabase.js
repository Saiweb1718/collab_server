
import { createClient } from "@supabase/supabase-js";

import dotenv from 'dotenv'

dotenv.config()
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
        
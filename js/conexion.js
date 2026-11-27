// Conexión compartida con Supabase. La clave anon es pública; los permisos dependen de RLS.
const SUPABASE_URL = 'https://xylixxbxbpzztvqbadbp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5bGl4eGJ4YnB6enR2cWJhZGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MTQxNTEsImV4cCI6MjExMTE5MDE1MX0.UPRjjeU7irR4f6f3b5ZBXJj6sNMjVIZd_wpRaEoSabo';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

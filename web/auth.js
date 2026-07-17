/* DealAmigo — Supabase client + auth helpers (ES module).
   The anon key is public by design; row-level security protects the data. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://byrmunbfghezfonkqmqs.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cm11bmJmZ2hlemZvbmtxbXFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyODE3MjYsImV4cCI6MjA5OTg1NzcyNn0.0SJaM7BDWDgi7NkG-Mw2elEwfdruX2UZBwItNJTFgTQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function getRole() {
  const s = await getSession();
  return s ? s.user.user_metadata?.role || "buyer" : null;
}

export function homeForRole(role) {
  return role === "owner" ? "dashboard.html" : "shops.html";
}

/* Guard a page: bounce to login if there's no session.
   basePath is "" for root pages, "../" for pages inside a subfolder. */
export async function requireAuth(basePath = "") {
  const s = await getSession();
  if (!s && !location.search.includes("preview=1")) location.replace(basePath + "login.html");
  return s;
}

export async function signOut(basePath = "") {
  await supabase.auth.signOut();
  location.replace(basePath + "index.html");
}

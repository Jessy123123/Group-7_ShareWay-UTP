// Supabase connection for real logins and bookings.
//
// Find both values in Supabase: Project Settings -> API Keys (or the green
// "Connect" button). Leave SUPABASE_KEY empty to run the site in demo mode,
// where bookings are only saved in the visitor's browser.
//
// The PUBLISHABLE key (starts with sb_publishable_) is meant to be public and
// is safe in this file: the security rules in supabase/schema.sql decide what
// each user can see and change. NEVER put the secret / service_role key here.

export const SUPABASE_URL = "https://rmayivozvuwhporkycpi.supabase.co";
export const SUPABASE_KEY = "sb_publishable_W3rQTXrtovFJ7BBSODClCg_0nIoHGXB";

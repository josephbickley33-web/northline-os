// Northline connection settings. deploy.sh overwrites this file with real values.
// The anon (public) key is designed to be shipped to browsers; Row Level Security protects the data.
// Never put the service_role key or a personal access token here.
window.NORTHLINE_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
};

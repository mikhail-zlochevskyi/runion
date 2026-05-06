/** Canonical origin for Supabase auth redirects (magic link, email confirmation). Prefer NEXT_PUBLIC_SITE_URL in production. */
export function authSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

import { redirect } from "next/navigation";
import { DEFAULT_CITY } from "@/lib/config";

// Older confirmation emails pointed Supabase's redirect at the bare origin, so
// they land here as `/?code=...`. Forward those to the auth callback (carrying
// the query) instead of dropping the code on the way to the map.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params?.code || params?.error || params?.error_description) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") qs.set(key, value);
    }
    redirect(`/auth/callback?${qs.toString()}`);
  }
  redirect(`/map#${DEFAULT_CITY}`);
}

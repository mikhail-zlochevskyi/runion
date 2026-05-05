import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { match_id, reviewee_id } = await request.json();
  const supabase = serviceClient();

  const { error: matchError } = await supabase.from("matches").update({ status: "no_show" }).eq("id", match_id);
  if (matchError) return Response.json({ error: matchError.message }, { status: 500, headers: corsHeaders });

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("reliability_score")
    .eq("id", reviewee_id)
    .single();

  if (userError) return Response.json({ error: userError.message }, { status: 500, headers: corsHeaders });

  const reliability_score = Math.max(0, Number(user.reliability_score) - 15);
  await supabase.from("users").update({ reliability_score }).eq("id", reviewee_id);

  return Response.json({ reliability_score }, { headers: corsHeaders });
});

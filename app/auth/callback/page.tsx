"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_CITY } from "@/lib/config";
import { captureUtm } from "@/lib/utm";

// Auth landing page for email confirmation and magic links.
//
// Supabase redirects here with either a PKCE `?code=...` query (signup /
// recovery) or a `#access_token=...` hash (implicit magic link). The browser
// client has `detectSessionInUrl` on by default, so it auto-exchanges the code
// and fires `onAuthStateChange` once a session exists. We just wait for that
// session, then route into the app. This MUST be client-side: the PKCE
// verifier lives in this browser's storage, so a server route can't complete it.
export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    captureUtm();
    const supabase = createClient();
    if (!supabase) {
      router.replace(`/map#${DEFAULT_CITY}`);
      return;
    }

    // Surface an explicit error Supabase passed back (expired/used link, etc.)
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const errDesc = search.get("error_description") || hash.get("error_description");
    const hasCode = search.has("code") || hash.has("access_token");
    if (errDesc && !hasCode) {
      setError(errDesc.replace(/\+/g, " "));
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      router.replace(`/map#${DEFAULT_CITY}`);
    };

    // Either a session is already established, or detectSessionInUrl will
    // exchange the code and emit SIGNED_IN shortly.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });

    // Fallback: if no session lands (e.g. link opened on a different device or
    // browser than the one that started signup, so the PKCE verifier is missing).
    const timer = setTimeout(() => {
      if (!done) {
        setError(
          "We couldn't finish signing you in. Open the link on the same device and browser where you signed up, or request a new one."
        );
      }
    }, 8000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <main className="auth-callback">
      {error ? (
        <div className="auth-callback-card">
          <p className="auth-callback-title">Couldn&apos;t complete sign-in</p>
          <p className="auth-callback-sub">{error}</p>
          <button type="button" className="text-btn" onClick={() => router.replace("/auth/login")}>
            Back to sign in
          </button>
        </div>
      ) : (
        <div className="auth-callback-card">
          <p className="auth-callback-title">Signing you in…</p>
          <p className="auth-callback-sub">One moment while we confirm your email.</p>
        </div>
      )}
    </main>
  );
}

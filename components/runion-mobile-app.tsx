"use client";

import "leaflet/dist/leaflet.css";

import { ArrowLeft, CalendarClock, Camera, Check, LocateFixed, Lock, LogOut, Mail, MapPin, MessageCircle, Plus, Save, Sparkles, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, PointerEvent, ReactNode, SetStateAction } from "react";
import type { CitySlug, PreferredGroupSize, RunAvailability, RunIntent, RunnerProfile, RunnerType } from "@/lib/types";
import { authSiteUrl } from "@/lib/auth-site-url";
import { CITY_CONFIG } from "@/lib/config";
import {
  cancelOwnRequest as apiCancelOwnRequest,
  createRun as apiCreateRun,
  detectSocialsPlatform,
  fetchMyActivity as apiFetchMyActivity,
  fetchOpenRuns,
  isValidSocialsUrl,
  openSpots as runOpenSpots,
  paceLabel as runPaceLabel,
  requestSpot as apiRequestSpot,
  setRequestStatus as apiSetRequestStatus,
  dayLabel as runDayLabel,
  timeLabel as runTimeLabel,
  type ParticipantRow,
  type ParticipantStatus as ApiParticipantStatus,
  type RunRow,
} from "@/lib/api/runs";
import { createClient } from "@/lib/supabase/client";

type Props = {
  initialCity: CitySlug;
};

type AuthMode = "magic" | "password";
type AppState = "loading" | "auth" | "onboarding" | "runs";
type RunsTab = "map" | "post" | "runs";
type SheetState = "hidden" | "peek" | "full";
type LocationStatus = "idle" | "locating" | "found" | "denied" | "unavailable";
type MapRunFilter = "all" | "pace_500_530" | "pace_530_600" | "social" | "tempo";

type OnboardingDraft = Omit<RunnerProfile, "onboarding_completed">;
type CoreIntent = "tempo" | "social" | "consistency";
type ParticipantStatus = "requested" | "confirmed" | "declined";
type CoreRun = {
  id: string;
  city?: CitySlug;
  title: string;
  description?: string;
  paceSeconds: number;
  paceMin: string;
  paceMax: string;
  distanceKm: number;
  startTime: string;
  locationName: string;
  intent: CoreIntent;
  participants: string;
  maxGroupSize: number;
  currentSpots: number;
  status: string;
  source: "db" | "mock" | "local";
};

type RunParticipantActivity = {
  id: string;
  run: CoreRun;
  status: ParticipantStatus;
  requesterName: string;
  requesterWhatsapp?: string;
  requesterSocials?: string;
  requesterPace?: number;
  requesterIntent?: CoreIntent;
  createdAt: string;
};

type HostedRunActivity = {
  run: CoreRun;
  confirmedCount: number;
  confirmedRequests: RunParticipantActivity[];
  pendingRequests: RunParticipantActivity[];
};

type PostRunDraft = {
  startTime: string;
  paceSeconds: number;
  distanceKm: number;
  intent: CoreIntent;
  locationName: string;
  pickedLat: number | null;
  pickedLng: number | null;
};

const CITY_BOUNDS: Record<CitySlug, { south: number; west: number; north: number; east: number }> = {
  bcn: { south: 41.32, west: 2.05, north: 41.47, east: 2.23 },
  sg: { south: 1.20, west: 103.59, north: 1.48, east: 104.05 },
  par: { south: 48.815, west: 2.224, north: 48.902, east: 2.469 },
  ber: { south: 52.339, west: 13.090, north: 52.675, east: 13.761 },
};

function isWithinCity(city: CitySlug, lat: number, lng: number) {
  const b = CITY_BOUNDS[city];
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

const STORAGE_KEY = "runion.preview.profile";
const WHATSAPP_PRIVACY_COPY = "Shared with hosts only after they approve your request, so you can coordinate. Not public.";
const SHEET_STATES: SheetState[] = ["hidden", "peek", "full"];
const intentLabels: Record<CoreIntent, string> = {
  tempo: "TEMPO",
  social: "SOCIAL",
  consistency: "CONSISTENCY"
};

const postRunIntentChoices: { value: CoreIntent; headline: string; detail: string }[] = [
  { value: "tempo", headline: "TEMPO", detail: "Quality work — harder pace or intervals." },
  { value: "social", headline: "SOCIAL", detail: "Easy miles and conversation." },
  { value: "consistency", headline: "CONSISTENCY", detail: "Steady habit — show up, lock it in." }
];

const runnerTypes: { value: RunnerType; label: string; detail: string }[] = [
  { value: "performance_focused", label: "Performance Focused", detail: "Wants sharper sessions, faster pace, improvement" },
  { value: "explorer", label: "Explorer", detail: "Enjoys new routes, neighborhoods, scenery" },
  { value: "social_connector", label: "Social Connector", detail: "Runs to meet people and share the miles" }
];

const intents: { value: RunIntent; label: string; detail: string }[] = [
  { value: "build_routine", label: "Build a routine", detail: "Make running a regular habit" },
  { value: "find_partners", label: "Find running partners", detail: "Meet people to run with regularly" },
  { value: "train_event", label: "Train for an event", detail: "Prepare for a race or challenge" },
  { value: "improve_speed", label: "Improve speed", detail: "Get faster or push performance" },
  { value: "increase_distance", label: "Increase distance", detail: "Work toward longer runs" },
  { value: "recover_gently", label: "Recover gently", detail: "Ease back in safely" },
  { value: "discover_routes", label: "Discover routes", detail: "Explore new places to run" },
  { value: "stay_accountable", label: "Stay accountable", detail: "Use others as motivation to show up" }
];

const availabilityOptions: { value: RunAvailability; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "weekends", label: "Weekends" }
];

const groupSizes: { value: PreferredGroupSize; label: string; recommended?: boolean }[] = [
  { value: "one_to_one", label: "1:1" },
  { value: "two_to_three", label: "2-3", recommended: true },
  { value: "four_plus", label: "4+" }
];

const mapRunFilters: { value: MapRunFilter; label: string }[] = [
  { value: "all", label: "All runs" },
  { value: "pace_500_530", label: "5:00-5:30 /km" },
  { value: "pace_530_600", label: "5:30-6:00 /km" },
  { value: "social", label: "Easy / social" },
  { value: "tempo", label: "Tempo" }
];

const defaultDraft: OnboardingDraft = {
  name: "",
  runner_type: "social_connector",
  comfortable_pace_seconds_per_km: 315,
  comfortable_pace_min_seconds_per_km: 300,
  comfortable_pace_max_seconds_per_km: 330,
  run_intents: ["build_routine"],
  availability: ["morning"],
  preferred_group_size: "two_to_three",
  whatsapp: "",
  socials_url: "",
  profile_photo_url: ""
};

function coerceRunnerType(value?: string | null): RunnerType {
  if (value === "performance_focused" || value === "explorer" || value === "social_connector") return value;
  if (value === "race_training") return "performance_focused";
  return "social_connector";
}

function coerceRunIntent(value?: string | null): RunIntent | null {
  if (
    value === "build_routine" ||
    value === "find_partners" ||
    value === "train_event" ||
    value === "improve_speed" ||
    value === "increase_distance" ||
    value === "recover_gently" ||
    value === "discover_routes" ||
    value === "stay_accountable"
  ) {
    return value;
  }
  if (value === "consistency") return "build_routine";
  if (value === "performance") return "improve_speed";
  if (value === "like_minded" || value === "easy_social") return "find_partners";
  return null;
}

function coerceRunIntents(values?: string[] | null): RunIntent[] {
  const normalized = (values ?? []).map(coerceRunIntent).filter((value): value is RunIntent => Boolean(value));
  return Array.from(new Set(normalized)).slice(0, intents.length);
}

function normalizeProfileDraft(profile: Partial<RunnerProfile>): OnboardingDraft {
  const runIntents = coerceRunIntents(profile.run_intents as string[] | undefined);
  return {
    ...defaultDraft,
    ...profile,
    runner_type: coerceRunnerType(profile.runner_type),
    run_intents: runIntents.length ? runIntents : defaultDraft.run_intents,
    availability: profile.availability?.length ? profile.availability : defaultDraft.availability
  };
}

const matchCopy: Record<string, { title: string; level: string; people: string; tagline: string }> = {
  "sg-1": { title: "Marina Bay waterfront", level: "Easy", people: "Mei + 1 runner", tagline: "Scenic steady" },
  "sg-2": { title: "East Coast sunrise", level: "Social", people: "2 runners", tagline: "Coffee after" },
  "sg-3": { title: "Bishan Park loop", level: "Recovery", people: "Asha + 1 runner", tagline: "Low pressure" },
  "sg-4": { title: "Southern Ridges", level: "Hills", people: "Ravi", tagline: "Views + climbs" },
  "sg-5": { title: "Sentosa beach path", level: "Easy", people: "Nora + 1 runner", tagline: "Beach breeze" },
  "sg-6": { title: "Kallang River tempo", level: "Tempo", people: "Leo", tagline: "Steady effort" },
  "bcn-1": { title: "Easy Social Run", level: "Easy", people: "2 runners", tagline: "Chill + chat" },
  "bcn-2": { title: "Coffee Loop", level: "Social", people: "Clara + 1 runner", tagline: "Coffee after" },
  "bcn-3": { title: "Tempo Crew", level: "Intermediate", people: "Elena + 2 runners", tagline: "Steady effort" },
  "bcn-4": { title: "Trail Pairing", level: "Trail", people: "Pau + 1 runner", tagline: "Hills + views" }
};

export function RunionMobileApp({ initialCity }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [city, setCity] = useState<CitySlug>(initialCity);
  const [appState, setAppState] = useState<AppState>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("magic");
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [draft, setDraft] = useState<OnboardingDraft>(defaultDraft);
  const [step, setStep] = useState(0);
  const [requestedRunId, setRequestedRunId] = useState("");
  const [profileId, setProfileId] = useState<string | undefined>();
  const [profileEmail, setProfileEmail] = useState<string | undefined>();

  useEffect(() => {
    function syncCityFromHash() {
      const hashCity = cityFromHash(window.location.hash);
      if (hashCity) setCity(hashCity);
    }

    syncCityFromHash();
    window.addEventListener("hashchange", syncCityFromHash);
    return () => window.removeEventListener("hashchange", syncCityFromHash);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      if (!supabase) {
        const previewProfile = readPreviewProfile();
        if (previewProfile?.onboarding_completed) {
          setDraft(normalizeProfileDraft(previewProfile));
          setAppState("runs");
        } else {
          setAppState("auth");
        }
        return;
      }

      const { data } = await supabase.auth.getUser();
      if (!mounted) return;

      if (!data.user) {
        setAppState("auth");
        return;
      }

      setProfileId(data.user.id);
      setProfileEmail(data.user.email ?? undefined);
      await loadProfile(data.user.id, data.user.email ?? undefined, getAuthProfile(data.user.user_metadata));
    }

    loadSession();

    const { data: listener } =
      supabase?.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        if (!user) {
          setAppState("auth");
          return;
        }
        setProfileId(user.id);
        setProfileEmail(user.email ?? undefined);
        loadProfile(user.id, user.email ?? undefined, getAuthProfile(user.user_metadata));
      }) ?? {};

    return () => {
      mounted = false;
      listener?.subscription.unsubscribe();
    };
  // loadProfile is intentionally scoped to the current Supabase client; this effect already reruns when that client changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (appState === "auth" && pathname === "/profile") {
      router.replace("/auth/login");
    }
  }, [appState, pathname, router]);

  async function loadProfile(userId: string, userEmail?: string, authProfile?: { name?: string; photoUrl?: string }) {
    if (!supabase) return;

    const { data } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
    if (data) {
      setDraft(normalizeProfileDraft({
        name: data.name ?? authProfile?.name ?? "",
        runner_type: data.runner_type ?? defaultDraft.runner_type,
        comfortable_pace_seconds_per_km: data.comfortable_pace_seconds_per_km ?? defaultDraft.comfortable_pace_seconds_per_km,
        comfortable_pace_min_seconds_per_km:
          data.comfortable_pace_min_seconds_per_km ?? paceRangeFromCenter(data.comfortable_pace_seconds_per_km ?? defaultDraft.comfortable_pace_seconds_per_km).min,
        comfortable_pace_max_seconds_per_km:
          data.comfortable_pace_max_seconds_per_km ?? paceRangeFromCenter(data.comfortable_pace_seconds_per_km ?? defaultDraft.comfortable_pace_seconds_per_km).max,
        run_intents: data.run_intents?.length ? data.run_intents : defaultDraft.run_intents,
        availability: data.availability?.length ? data.availability : defaultDraft.availability,
        preferred_group_size: data.preferred_group_size ?? defaultDraft.preferred_group_size,
        whatsapp: data.whatsapp ?? "",
        socials_url: data.socials_url ?? "",
        profile_photo_url: data.avatar_url ?? data.profile_photo_url ?? authProfile?.photoUrl ?? ""
      }));
      if (pathname === "/profile") {
        setAppState("runs");
      } else if (data.onboarding_completed) {
        setAppState("runs");
        if (pathname === "/") router.replace(`/map#${city}`);
      } else {
        setAppState("onboarding");
      }
      return;
    }

    setDraft((current) => ({
      ...current,
      name: current.name || authProfile?.name || userEmail?.split("@")[0] || "",
      profile_photo_url: current.profile_photo_url || authProfile?.photoUrl || ""
    }));
    setAppState(pathname === "/profile" ? "runs" : "onboarding");
  }

  async function saveProfileChanges(profile: OnboardingDraft) {
    const cleanedWhatsapp = normalizeWhatsapp(profile.whatsapp);
    const cleanedSocials = profile.socials_url?.trim() ?? "";
    if (cleanedSocials && !isValidSocialsUrl(cleanedSocials)) {
      return { ok: false, message: "Social link must be a Strava, Instagram, or Garmin URL." };
    }
    const paceRange = normalizePaceRange(profile);
    const nextProfile: RunnerProfile = {
      ...profile,
      id: profileId,
      email: profileEmail,
      name: profile.name.trim() || "Runner",
      whatsapp: cleanedWhatsapp,
      socials_url: cleanedSocials,
      comfortable_pace_seconds_per_km: paceRange.center,
      comfortable_pace_min_seconds_per_km: paceRange.min,
      comfortable_pace_max_seconds_per_km: paceRange.max,
      onboarding_completed: true
    };

    if (!supabase || profileId === "preview-user") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile));
      setDraft(nextProfile);
      return { ok: true, message: "" };
    }

    if (!profileId) return { ok: false, message: "Sign in again to save your profile." };

    const payload = {
      id: profileId,
      email: profileEmail,
      name: nextProfile.name,
      runner_type: nextProfile.runner_type,
      comfortable_pace_seconds_per_km: nextProfile.comfortable_pace_seconds_per_km,
      comfortable_pace_min_seconds_per_km: nextProfile.comfortable_pace_min_seconds_per_km,
      comfortable_pace_max_seconds_per_km: nextProfile.comfortable_pace_max_seconds_per_km,
      run_intents: nextProfile.run_intents,
      availability: nextProfile.availability,
      preferred_group_size: nextProfile.preferred_group_size,
      whatsapp: nextProfile.whatsapp,
      socials_url: nextProfile.socials_url,
      avatar_url: nextProfile.profile_photo_url || null,
      onboarding_completed: true
    };

    const { error } = await supabase.from("users").upsert(payload);

    if (error && isMissingPaceRangeColumnError(error.message)) {
      const { error: fallbackError } = await supabase.from("users").upsert({
        ...payload,
        comfortable_pace_min_seconds_per_km: undefined,
        comfortable_pace_max_seconds_per_km: undefined
      });

      if (fallbackError) return { ok: false, message: fallbackError.message };
      setDraft(nextProfile);
      return { ok: true, message: "" };
    }

    if (error) return { ok: false, message: error.message };

    setDraft(nextProfile);
    return { ok: true, message: "" };
  }

  async function signOut() {
    if (supabase && profileId !== "preview-user") {
      await supabase.auth.signOut();
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    setProfileId(undefined);
    setProfileEmail(undefined);
    setDraft(defaultDraft);
    setAppState("auth");
    router.replace("/auth/login");
  }

  async function signInWithGoogle() {
    if (!supabase) {
      startPreview();
      return;
    }

    setAuthBusy(true);
    setAuthNotice("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authSiteUrl() }
    });
    if (error) setAuthNotice(error.message);
    setAuthBusy(false);
  }

  async function signInWithEmail() {
    if (!email.trim()) {
      setAuthNotice("Add your email to continue.");
      return;
    }

    if (!supabase) {
      startPreview(email);
      return;
    }

    setAuthBusy(true);
    setAuthNotice("");
    const redirectTo = authSiteUrl();

    if (authMode === "magic") {
      const result = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      setAuthNotice(result.error ? result.error.message : "Magic link sent. Open it on this device to keep going.");
      setAuthBusy(false);
      return;
    }

    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (!signIn.error) {
      setAuthBusy(false);
      return;
    }
    if (/invalid login credentials/i.test(signIn.error.message)) {
      const signUp = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
      setAuthNotice(signUp.error ? signUp.error.message : "Account created. Check your inbox if confirmation is required.");
    } else {
      setAuthNotice(signIn.error.message);
    }
    setAuthBusy(false);
  }

  function startPreview(previewEmail = "preview@runion.app") {
    setProfileId("preview-user");
    setProfileEmail(previewEmail);
    setDraft((current) => ({ ...current, name: current.name || previewEmail.split("@")[0] }));
    setAppState("onboarding");
  }

  function nextStep() {
    if (step < 5) {
      setStep((current) => current + 1);
      return;
    }
    completeOnboarding();
  }

  async function completeOnboarding() {
    const cleanedWhatsapp = normalizeWhatsapp(draft.whatsapp);
    const cleanedSocials = draft.socials_url?.trim() ?? "";
    if (cleanedSocials && !isValidSocialsUrl(cleanedSocials)) {
      setAuthNotice("Social link must be a Strava, Instagram, or Garmin URL.");
      return;
    }
    const profile: RunnerProfile = {
      ...draft,
      id: profileId,
      email: profileEmail,
      name: draft.name.trim() || "Runner",
      whatsapp: cleanedWhatsapp,
      socials_url: cleanedSocials,
      comfortable_pace_min_seconds_per_km: draft.comfortable_pace_min_seconds_per_km ?? paceRangeFromCenter(draft.comfortable_pace_seconds_per_km).min,
      comfortable_pace_max_seconds_per_km: draft.comfortable_pace_max_seconds_per_km ?? paceRangeFromCenter(draft.comfortable_pace_seconds_per_km).max,
      onboarding_completed: true
    };

    if (!supabase || profileId === "preview-user") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      setDraft(profile);
      setAppState("runs");
      router.replace(`/map#${city}`);
      return;
    }

    const { error } = await supabase.from("users").upsert({
      id: profileId,
      email: profileEmail,
      name: profile.name,
      runner_type: profile.runner_type,
      comfortable_pace_seconds_per_km: profile.comfortable_pace_seconds_per_km,
      run_intents: profile.run_intents,
      availability: profile.availability,
      preferred_group_size: profile.preferred_group_size,
      whatsapp: profile.whatsapp,
      socials_url: profile.socials_url,
      avatar_url: profile.profile_photo_url || null,
      onboarding_completed: true
    });

    if (error) {
      setAuthNotice(error.message);
      return;
    }

    setDraft(profile);
    setAppState("runs");
    router.replace(`/map#${city}`);
  }

  function requestSpot(runId: string) {
    setRequestedRunId(runId);
  }

  if (appState === "loading") {
    return (
      <main className="app-shell onboarding-shell">
        <BrandBar />
        <section className="loading-pane">
          <Sparkles size={22} />
          <p>Finding your pace...</p>
        </section>
      </main>
    );
  }

  if (appState === "auth") {
    return (
      <main className="app-shell onboarding-shell">
        <BrandBar />
        <section className="entry-panel">
          <div className="entry-copy">
            <p className="modal-eyebrow">Runion · {city.toUpperCase()}</p>
            <h1>Find 2-3 runners at your pace. No random groups.</h1>
            <p>Answer a few quick questions and see small runs that fit your rhythm this week.</p>
          </div>

          <div className="auth-panel">
            <button className="primary-cta google" onClick={signInWithGoogle} disabled={authBusy}>
              <Sparkles size={18} />
              Get matched with Google
            </button>

            <div className="auth-divider">or</div>

            <div className="segmented">
              <button className={authMode === "magic" ? "active" : ""} onClick={() => setAuthMode("magic")}>
                Magic link
              </button>
              <button className={authMode === "password" ? "active" : ""} onClick={() => setAuthMode("password")}>
                Password
              </button>
            </div>

            <label className="field-label">
              Email
              <span className="input-wrap">
                <Mail size={16} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} inputMode="email" placeholder="you@email.com" />
              </span>
            </label>

            {authMode === "password" ? (
              <label className="field-label">
                Password
                <span className="input-wrap">
                  <Lock size={16} />
                  <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="8+ characters" />
                </span>
              </label>
            ) : null}

            <button className="primary-cta" onClick={signInWithEmail} disabled={authBusy || (authMode === "password" && password.length < 8)}>
              Get matched
            </button>

            {!supabase ? <button className="text-btn" onClick={() => startPreview(email || undefined)}>Preview without Supabase</button> : null}
            {authNotice ? <p className="auth-notice">{authNotice}</p> : null}
          </div>
        </section>
      </main>
    );
  }

  if (appState === "onboarding") {
    return (
      <main className="app-shell onboarding-shell">
        <BrandBar />
        <section className="onboarding-panel" aria-label="Runner onboarding">
          <div className="progress-row">
            <button className="round-btn" onClick={() => (step ? setStep((current) => current - 1) : setAppState("auth"))} aria-label="Back">
              <ArrowLeft size={17} />
            </button>
            <div className="progress-track">
              <span style={{ width: `${((step + 1) / 6) * 100}%` }} />
            </div>
            <small>{step + 1}/6</small>
          </div>

          <OnboardingStep step={step} draft={draft} setDraft={setDraft} />

          {authNotice ? <p className="auth-notice">{authNotice}</p> : null}

          <button className="primary-cta sticky-cta" onClick={nextStep} disabled={step === 5 && !draft.name.trim()}>
            {step === 5 ? "Show my matches" : "Continue"}
          </button>
        </section>
      </main>
    );
  }

  if (pathname === "/post-run") {
    return (
      <PostRunScreen
        city={city}
        profile={draft}
        profileId={profileId}
        supabase={supabase}
        onBack={() => router.push(`/runs#${city}`)}
        onMap={() => router.push(`/map#${city}`)}
        onPosted={() => {
          router.push(`/runs#${city}`);
        }}
        onProfile={() => router.push(`/profile#${city}`)}
      />
    );
  }

  if (pathname === "/profile") {
    return (
      <ProfileScreen
        profile={draft}
        email={profileEmail}
        onProfileChange={setDraft}
        onBack={() => router.push(`/runs#${city}`)}
        onMap={() => router.push(`/map#${city}`)}
        onPostRun={() => router.push(`/post-run#${city}`)}
        onRuns={() => router.push(`/runs#${city}`)}
        onSave={saveProfileChanges}
        onSignOut={signOut}
      />
    );
  }

  if (pathname === "/map") {
    return (
      <MatchedRunsMap
        city={city}
        profile={draft}
        profileId={profileId}
        supabase={supabase}
        requestedRunId={requestedRunId}
        onRequest={requestSpot}
        onTuneProfile={() => setAppState("onboarding")}
        onPostRun={() => router.push(`/post-run#${city}`)}
        onShowRuns={() => router.push(`/runs#${city}`)}
        onProfile={() => router.push(`/profile#${city}`)}
      />
    );
  }

  return (
    <RunsFeed
      city={city}
      profile={draft}
      profileId={profileId}
      supabase={supabase}
      onOpenMap={() => router.push(`/map#${city}`)}
      onPostRun={() => router.push(`/post-run#${city}`)}
      onProfile={() => router.push(`/profile#${city}`)}
    />
  );
}

function OnboardingStep({
  step,
  draft,
  setDraft
}: {
  step: number;
  draft: OnboardingDraft;
  setDraft: Dispatch<SetStateAction<OnboardingDraft>>;
}) {
  if (step === 0) {
    return (
      <div className="step-card">
        <Question title="What kind of runner are you?" />
        <OptionStack
          options={runnerTypes.map((item) => ({ ...item, active: draft.runner_type === item.value }))}
          onSelect={(value) => setDraft((current) => ({ ...current, runner_type: value as RunnerType }))}
        />
      </div>
    );
  }

  if (step === 1) {
    const paceRange = normalizePaceRange(draft);
    const minPercent = ((paceRange.min - 270) / 150) * 100;
    const maxPercent = ((paceRange.max - 270) / 150) * 100;

    return (
      <div className="step-card">
        <Question title="What's your comfortable pace range?" detail="Use the easy range you could hold while still talking." />
        <div className="pace-readout" aria-live="polite">
          <span>{formatPace(paceRange.min)}-{formatPace(paceRange.max)}</span>
          <small>/km</small>
        </div>
        <div
          className="onboarding-pace-range"
          style={
            {
              "--pace-min": `${minPercent}%`,
              "--pace-max": `${maxPercent}%`
            } as CSSProperties
          }
        >
          <div className="pace-range-values">
            <span>Min {formatPace(paceRange.min)}</span>
            <span>Max {formatPace(paceRange.max)}</span>
          </div>
          <div className="dual-pace-slider">
            <input
              aria-label="Minimum comfortable pace"
              type="range"
              min={270}
              max={420}
              step={15}
              value={paceRange.min}
              onChange={(event) =>
                setDraft((current) => {
                  const currentRange = normalizePaceRange(current);
                  const min = Number(event.target.value);
                  const max = Math.max(min, currentRange.max);
                  return {
                    ...current,
                    comfortable_pace_seconds_per_km: Math.round((min + max) / 2),
                    comfortable_pace_min_seconds_per_km: min,
                    comfortable_pace_max_seconds_per_km: max
                  };
                })
              }
            />
            <input
              aria-label="Maximum comfortable pace"
              type="range"
              min={270}
              max={420}
              step={15}
              value={paceRange.max}
              onChange={(event) =>
                setDraft((current) => {
                  const currentRange = normalizePaceRange(current);
                  const max = Number(event.target.value);
                  const min = Math.min(currentRange.min, max);
                  return {
                    ...current,
                    comfortable_pace_seconds_per_km: Math.round((min + max) / 2),
                    comfortable_pace_min_seconds_per_km: min,
                    comfortable_pace_max_seconds_per_km: max
                  };
                })
              }
            />
          </div>
          <div className="slider-labels">
            <span>4:30</span>
            <span>7:00</span>
          </div>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="step-card">
        <Question title="Why do you want to run with others?" />
        <OptionStack
          options={intents.map((item) => ({ value: item.value, label: item.label, detail: item.detail, active: draft.run_intents.includes(item.value) }))}
          onSelect={(value) =>
            setDraft((current) => ({
              ...current,
              run_intents: toggleValue(current.run_intents, value as RunIntent)
            }))
          }
        />
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="step-card">
        <Question title="When do you usually run?" detail="Pick every window that works." />
        <OptionStack
          options={availabilityOptions.map((item) => ({ value: item.value, label: item.label, active: draft.availability.includes(item.value) }))}
          onSelect={(value) =>
            setDraft((current) => ({
              ...current,
              availability: toggleValue(current.availability, value as RunAvailability)
            }))
          }
        />
      </div>
    );
  }

  if (step === 4) {
    return (
      <div className="step-card">
        <Question title="Ideal group size?" />
        <OptionStack
          options={groupSizes.map((item) => ({
            value: item.value,
            label: item.label,
            detail: item.recommended ? "Best fit for Runion" : undefined,
            active: draft.preferred_group_size === item.value
          }))}
          onSelect={(value) => setDraft((current) => ({ ...current, preferred_group_size: value as PreferredGroupSize }))}
        />
      </div>
    );
  }

  return (
    <div className="step-card">
      <Question title="Your trust profile" detail="Just enough for runners to recognize who they're meeting." />
      {/* TODO: Wire this to the existing Supabase Storage upload flow once profile photos are enabled. */}
      <button className="photo-placeholder" type="button">
        {draft.profile_photo_url ? (
          // Google OAuth avatars are remote provider images; keep this direct until profile photo storage is wired.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="photo-avatar" src={draft.profile_photo_url} alt="" referrerPolicy="no-referrer" />
        ) : (
          <Camera size={20} />
        )}
        <span>{draft.profile_photo_url ? "Photo from your account" : "Add photo later"}</span>
      </button>
      <label className="field-label">
        Name
        <span className="input-wrap">
          <UserRound size={16} />
          <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Your name" />
        </span>
      </label>
      <label className="field-label">
        WhatsApp
        <span className={`input-wrap${(draft.whatsapp ?? "").trim() ? "" : " input-wrap--incomplete"}`}>
          <MessageCircle size={16} />
          <input
            value={draft.whatsapp ?? ""}
            onChange={(event) => setDraft((current) => ({ ...current, whatsapp: event.target.value }))}
            inputMode="tel"
            placeholder="+34 600 000 000"
          />
        </span>
        <span className="privacy-note">{WHATSAPP_PRIVACY_COPY}</span>
      </label>
      <label className="field-label">
        Socials
        <span className={`input-wrap${(draft.socials_url ?? "").trim() ? "" : " input-wrap--incomplete"}`}>
          <input
            value={draft.socials_url ?? ""}
            onChange={(event) => setDraft((current) => ({ ...current, socials_url: event.target.value }))}
            inputMode="url"
            placeholder="Paste a Strava, Instagram, or Garmin link"
          />
        </span>
        <span className="privacy-note">Helps people understand who they&apos;re running with. Hosts see this when you request a spot.</span>
      </label>
    </div>
  );
}

function RunsFeed({
  city,
  profile,
  profileId,
  supabase,
  onOpenMap,
  onPostRun,
  onProfile,
}: {
  city: CitySlug;
  profile: OnboardingDraft;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
  onOpenMap: () => void;
  onPostRun: () => void;
  onProfile: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [activity, setActivity] = useState<{ pending: RunParticipantActivity[]; confirmed: RunParticipantActivity[]; hosted: HostedRunActivity[] }>({
    pending: [],
    confirmed: [],
    hosted: []
  });

  useEffect(() => {
    let mounted = true;

    async function loadRuns() {
      setLoading(true);
      if (!profileId || profileId === "preview-user") {
        if (mounted) {
          setActivity({ pending: [], confirmed: [], hosted: [] });
          setLoading(false);
        }
        return;
      }
      const raw = await apiFetchMyActivity(supabase, { profileId });
      if (!mounted) return;
      setActivity(adaptMyActivity(raw, profile));
      setLoading(false);
    }

    loadRuns();

    return () => {
      mounted = false;
    };
  }, [city, profile, profileId, supabase]);

  // Subscribe to live updates affecting this user's activity.
  useEffect(() => {
    if (!supabase || !profileId || profileId === "preview-user") return;
    const refetch = async () => {
      const raw = await apiFetchMyActivity(supabase, { profileId });
      setActivity(adaptMyActivity(raw, profile));
    };
    const myRequests = supabase
      .channel(`run_participants:user:${profileId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "run_participants", filter: `user_id=eq.${profileId}` },
        refetch
      )
      .subscribe();
    const myHostedRuns = supabase
      .channel(`runs:organiser:${profileId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `organiser_id=eq.${profileId}` },
        refetch
      )
      .subscribe();
    return () => {
      supabase.removeChannel(myRequests);
      supabase.removeChannel(myHostedRuns);
    };
  }, [supabase, profileId, profile]);

  async function refreshActivity(message?: string) {
    if (!profileId || profileId === "preview-user") return;
    const raw = await apiFetchMyActivity(supabase, { profileId });
    setActivity(adaptMyActivity(raw, profile));
    if (message) setToast(message);
  }

  async function updateRequestStatus(request: RunParticipantActivity, status: ParticipantStatus) {
    if (status === "declined" || status === "confirmed") {
      const result = await apiSetRequestStatus(supabase, {
        participantId: request.id,
        status: status as ApiParticipantStatus,
      });
      if (result.ok) {
        await refreshActivity(status === "confirmed" ? "Request approved." : "Request declined.");
      } else {
        setToast(result.error || "Could not update this request. Try again.");
      }
      return;
    }
    if (status === "requested") {
      const result = await apiCancelOwnRequest(supabase, { participantId: request.id });
      if (result.ok) {
        await refreshActivity("Request cancelled.");
      } else {
        setToast(result.error || "Could not cancel this request. Try again.");
      }
    }
  }

  return (
    <main className="app-shell matches-shell runs-shell">
      <BrandBar onProfile={onProfile} />
      <section className="runs-panel" aria-label="Your runs">
        <header className="runs-header">
          <p className="modal-eyebrow">Your runs</p>
          <h1>Matches &amp; requests</h1>
          <p>Track spots you requested and people joining your runs.</p>
        </header>

        {toast ? <div className="feed-toast">{toast}</div> : null}

        {loading ? (
          <section className="feed-loading">
            <Sparkles size={20} />
            <p>Loading your runs...</p>
          </section>
        ) : hasRunActivity(activity) ? (
          <div className="my-runs-stack">
            <ActivitySection title="Confirmed runs" empty="No confirmed runs yet.">
              {activity.confirmed.map((item) => (
                <ActivityRunCard key={item.id} item={item} badge="Confirmed" note={item.run.participants} cta="View details" showApprovedContact />
              ))}
            </ActivitySection>

            <ActivitySection title="Pending requests" empty="No pending requests.">
              {activity.pending.map((item) => (
                <ActivityRunCard key={item.id} item={item} badge="Requested" note="Waiting for host approval" cta="View" />
              ))}
            </ActivitySection>

            <ActivitySection title="Your posted runs" empty="No posted runs yet.">
              {activity.hosted.map((hosted) => (
                <HostedRunCard
                  key={hosted.run.id}
                  hosted={hosted}
                  onApprove={(request) => updateRequestStatus(request, "confirmed")}
                  onDecline={(request) => updateRequestStatus(request, "declined")}
                />
              ))}
            </ActivitySection>
          </div>
        ) : (
          <section className="core-empty-state my-runs-empty">
            <h2>No runs yet</h2>
            <p>Find a run on the map or post your own.</p>
            <div className="empty-actions">
              <button className="primary-cta" onClick={onOpenMap}>Open map</button>
              <button className="secondary-cta" onClick={onPostRun}>Post a run</button>
            </div>
          </section>
        )}
      </section>
      <RunionTabNav active="runs" onMap={onOpenMap} onPost={onPostRun} onRuns={() => undefined} />
    </main>
  );
}

function ProfileScreen({
  profile,
  email,
  onProfileChange,
  onBack,
  onMap,
  onPostRun,
  onRuns,
  onSave,
  onSignOut
}: {
  profile: OnboardingDraft;
  email?: string;
  onProfileChange: Dispatch<SetStateAction<OnboardingDraft>>;
  onBack: () => void;
  onMap: () => void;
  onPostRun: () => void;
  onRuns: () => void;
  onSave: (profile: OnboardingDraft) => Promise<{ ok: boolean; message: string }>;
  onSignOut: () => Promise<void>;
}) {
  const [localProfile, setLocalProfile] = useState<OnboardingDraft>(() => ({
    ...normalizeProfileDraft(profile)
  }));
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLocalProfile({
      ...normalizeProfileDraft(profile)
    });
  }, [profile]);

  async function submitProfile() {
    setBusy(true);
    setNotice("");
    const paceRange = normalizePaceRange(localProfile);
    const nextProfile = {
      ...localProfile,
      name: localProfile.name.trim(),
      whatsapp: normalizeWhatsapp(localProfile.whatsapp),
      socials_url: localProfile.socials_url?.trim() ?? "",
      comfortable_pace_seconds_per_km: paceRange.center,
      comfortable_pace_min_seconds_per_km: paceRange.min,
      comfortable_pace_max_seconds_per_km: paceRange.max
    };
    const result = await onSave(nextProfile);
    setBusy(false);

    if (!result.ok) {
      setNotice(result.message || "Could not save profile. Try again.");
      return;
    }

    onProfileChange(nextProfile);
    setNotice("Profile updated");
  }

  return (
    <main className="app-shell matches-shell runs-shell profile-shell">
      <BrandBar />
      <section className="profile-panel" aria-label="Profile">
        <button className="round-btn" onClick={onBack} aria-label="Back to runs">
          <ArrowLeft size={17} />
        </button>
        <header className="runs-header profile-header">
          <p className="modal-eyebrow">RUNION</p>
          <h1>Profile</h1>
          <p>Keep your running preferences up to date.</p>
        </header>

        <section className="profile-identity" aria-label="Profile identity">
          <div className="profile-picture" aria-hidden="true">
            {localProfile.profile_photo_url ? (
              // Google OAuth avatars come from the identity provider; keep this direct until uploads exist.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={localProfile.profile_photo_url} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span>{initialsFromName(localProfile.name || email || "Runner")}</span>
            )}
          </div>
          <div>
            <strong>{localProfile.name || "Runner"}</strong>
            <span>{localProfile.profile_photo_url ? "Photo from Google account" : "No profile photo yet"}</span>
          </div>
        </section>

        <div className="profile-form">
          <label className="field-label">
            Name
            <span className="input-wrap">
              <UserRound size={16} />
              <input value={localProfile.name} onChange={(event) => setLocalProfile((current) => ({ ...current, name: event.target.value }))} placeholder="Your name" />
            </span>
          </label>

          <label className="field-label">
            Email
            <span className="input-wrap readonly">
              <Mail size={16} />
              <input value={email ?? ""} readOnly placeholder="you@email.com" />
            </span>
          </label>

          <label className="field-label">
            WhatsApp
            <span className={`input-wrap${(localProfile.whatsapp ?? "").trim() ? "" : " input-wrap--incomplete"}`}>
              <MessageCircle size={16} />
              <input
                value={localProfile.whatsapp ?? ""}
                onChange={(event) => setLocalProfile((current) => ({ ...current, whatsapp: event.target.value }))}
                inputMode="tel"
                placeholder="+65 8123 4567"
              />
            </span>
            <span className="privacy-note">{WHATSAPP_PRIVACY_COPY}</span>
          </label>

          <label className="field-label">
            Socials
            <span className={`input-wrap${(localProfile.socials_url ?? "").trim() ? "" : " input-wrap--incomplete"}`}>
              <input
                value={localProfile.socials_url ?? ""}
                onChange={(event) => setLocalProfile((current) => ({ ...current, socials_url: event.target.value }))}
                inputMode="url"
                placeholder="Paste a Strava, Instagram, or Garmin link"
              />
            </span>
            <span className="privacy-note">Helps people understand who they&apos;re running with. Hosts see this when you request a spot.</span>
          </label>

          <label className="field-label">
            Comfortable pace range
            <div className="pace-range-fields">
              <span className="input-wrap">
                <CalendarClock size={16} />
                <input
                  aria-label="Minimum comfortable pace"
                  value={formatPace(localProfile.comfortable_pace_min_seconds_per_km ?? paceRangeFromCenter(localProfile.comfortable_pace_seconds_per_km).min)}
                  inputMode="numeric"
                  onChange={(event) =>
                    setLocalProfile((current) => {
                      const currentRange = normalizePaceRange(current);
                      const min = parsePaceInput(event.target.value, currentRange.min);
                      const max = Math.max(min, currentRange.max);
                      return {
                        ...current,
                        comfortable_pace_seconds_per_km: Math.round((min + max) / 2),
                        comfortable_pace_min_seconds_per_km: min,
                        comfortable_pace_max_seconds_per_km: max
                      };
                    })
                  }
                  placeholder="5:00"
                />
                <span className="input-suffix">min</span>
              </span>
              <span className="pace-range-divider">to</span>
              <span className="input-wrap">
                <input
                  aria-label="Maximum comfortable pace"
                  value={formatPace(localProfile.comfortable_pace_max_seconds_per_km ?? paceRangeFromCenter(localProfile.comfortable_pace_seconds_per_km).max)}
                  inputMode="numeric"
                  onChange={(event) =>
                    setLocalProfile((current) => {
                      const currentRange = normalizePaceRange(current);
                      const max = parsePaceInput(event.target.value, currentRange.max);
                      const min = Math.min(currentRange.min, max);
                      return {
                        ...current,
                        comfortable_pace_seconds_per_km: Math.round((min + max) / 2),
                        comfortable_pace_min_seconds_per_km: min,
                        comfortable_pace_max_seconds_per_km: max
                      };
                    })
                  }
                  placeholder="5:30"
                />
                <span className="input-suffix">/km</span>
              </span>
            </div>
          </label>

          <ProfileChoiceGroup title="Runner type">
            <OptionStack
              options={runnerTypes.map((item) => ({ value: item.value, label: item.label, active: localProfile.runner_type === item.value }))}
              onSelect={(value) => setLocalProfile((current) => ({ ...current, runner_type: value as RunnerType }))}
            />
          </ProfileChoiceGroup>

          <ProfileChoiceGroup title="Intent">
            <OptionStack
              options={intents.map((item) => ({ value: item.value, label: item.label, detail: item.detail, active: localProfile.run_intents.includes(item.value) }))}
              onSelect={(value) =>
                setLocalProfile((current) => ({
                  ...current,
                  run_intents: toggleValue(current.run_intents, value as RunIntent)
                }))
              }
            />
          </ProfileChoiceGroup>

          <ProfileChoiceGroup title="Availability">
            <OptionStack
              options={availabilityOptions.map((item) => ({ value: item.value, label: item.label, active: localProfile.availability.includes(item.value) }))}
              onSelect={(value) =>
                setLocalProfile((current) => ({
                  ...current,
                  availability: toggleValue(current.availability, value as RunAvailability)
                }))
              }
            />
          </ProfileChoiceGroup>

          <ProfileChoiceGroup title="Preferred group size">
            <OptionStack
              options={groupSizes.map((item) => ({ value: item.value, label: item.label, active: localProfile.preferred_group_size === item.value }))}
              onSelect={(value) => setLocalProfile((current) => ({ ...current, preferred_group_size: value as PreferredGroupSize }))}
            />
          </ProfileChoiceGroup>
        </div>

        {notice ? <p className={`profile-notice${notice === "Profile updated" ? " success" : ""}`}>{notice}</p> : null}

        <div className="profile-actions">
          <button className="primary-cta" onClick={submitProfile} disabled={busy}>
            <Save size={17} />
            {busy ? "Saving..." : "Save changes"}
          </button>
          <button className="logout-cta" onClick={onSignOut}>
            <LogOut size={17} />
            Log out
          </button>
        </div>
      </section>
      <RunionTabNav active="runs" onMap={onMap} onPost={onPostRun} onRuns={onRuns} />
    </main>
  );
}

function ProfileChoiceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="profile-choice-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function CoreRunCard({
  run,
  requested,
  busy,
  onRequest
}: {
  run: CoreRun;
  requested: boolean;
  busy: boolean;
  onRequest: () => void;
}) {
  const full = run.currentSpots >= run.maxGroupSize;

  return (
    <article className={`core-run-card ${requested ? "requested" : ""}`}>
      <div className="core-run-main">
        <span className="intent-tag">{intentLabels[run.intent]}</span>
        <h2>{run.title}</h2>
        <div className="run-meta-grid">
          <span>
            <CalendarClock size={15} />
            {formatRunStart(run.startTime)}
          </span>
          <span>{run.distanceKm} km</span>
          <span>{formatPace(run.paceSeconds)}/km</span>
          <span>{run.participants}</span>
        </div>
        <p className="location-line">
          <MapPin size={15} />
          {run.locationName}
        </p>
      </div>
      {!full ? (
        <button className="detail-cta request-spot-btn" onClick={onRequest} disabled={requested || busy}>
          {requested ? "Spot requested" : busy ? "Requesting..." : "Request spot"}
        </button>
      ) : null}
      {requested ? <div className="success-state">Spot requested. We&apos;ll confirm your match.</div> : null}
    </article>
  );
}

function ActivitySection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);

  return (
    <section className="activity-section">
      <h2>{title}</h2>
      {hasChildren ? <div className="activity-list">{children}</div> : <p className="activity-empty">{empty}</p>}
    </section>
  );
}

function ActivityRunCard({
  item,
  badge,
  note,
  cta,
  showApprovedContact = false
}: {
  item: RunParticipantActivity;
  badge: string;
  note: string;
  cta: string;
  showApprovedContact?: boolean;
}) {
  return (
    <article className="activity-card">
      <div className="activity-card-head">
        <span className="status-badge">{badge}</span>
        <button className="text-btn">{cta}</button>
      </div>
      <h3>{item.run.title}</h3>
      <RunFactGrid run={item.run} />
      <p className="activity-note">{note}</p>
      {showApprovedContact ? <ApprovedContact whatsapp={item.requesterWhatsapp} fallback="Your WhatsApp is shared with the host for coordination." /> : null}
    </article>
  );
}

function HostedRunCard({
  hosted,
  onApprove,
  onDecline
}: {
  hosted: HostedRunActivity;
  onApprove: (request: RunParticipantActivity) => void;
  onDecline: (request: RunParticipantActivity) => void;
}) {
  return (
    <article className="activity-card hosted-card">
      <div className="activity-card-head">
        <span className="status-badge host">Hosting</span>
        {hosted.pendingRequests.length ? <button className="text-btn">Review requests</button> : null}
      </div>
      <h3>{hosted.run.title}</h3>
      <RunFactGrid run={hosted.run} />
      <div className="host-counts">
        <span>{hosted.confirmedCount} confirmed</span>
        <span>{hosted.pendingRequests.length} pending</span>
      </div>

      {hosted.confirmedRequests.length ? (
        <div className="approved-contact-list">
          {hosted.confirmedRequests.map((request) => (
            <div key={request.id} className="approved-contact">
              <strong>{request.requesterName}</strong>
              <RequesterSocials whatsapp={request.requesterWhatsapp} socials={request.requesterSocials} />
            </div>
          ))}
        </div>
      ) : null}

      {hosted.pendingRequests.length ? (
        <div className="incoming-list">
          {hosted.pendingRequests.map((request) => (
            <div className="incoming-request" key={request.id}>
              <div>
                <strong>{request.requesterName}</strong>
                <span>
                  {request.requesterPace ? `${formatPace(request.requesterPace)}/km` : "Pace not shared"} · {intentLabels[request.requesterIntent ?? "social"]}
                </span>
                <RequesterSocials socials={request.requesterSocials} />
              </div>
              <div className="request-actions">
                <button onClick={() => onApprove(request)}>Approve</button>
                <button onClick={() => onDecline(request)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function RequesterSocials({ whatsapp, socials }: { whatsapp?: string; socials?: string }) {
  if (!whatsapp && !socials) return null;
  const platform = socials ? detectSocialsPlatform(socials) : null;
  const platformLabel: Record<string, string> = {
    strava: "Strava",
    instagram: "Instagram",
    garmin: "Garmin",
  };
  const socialHref = socials ? (socials.startsWith("http") ? socials : `https://${socials}`) : "";
  return (
    <div className="requester-socials">
      {whatsapp ? (
        <a className="requester-social" href={whatsappHref(whatsapp)} target="_blank" rel="noreferrer">
          <MessageCircle size={13} />
          {whatsapp}
        </a>
      ) : null}
      {socials ? (
        <a
          className={`requester-social${platform ? ` requester-social--${platform}` : ""}`}
          href={socialHref}
          target="_blank"
          rel="noreferrer"
        >
          {platform ? <span className={`socials-tag socials-tag--${platform}`}>{platformLabel[platform]}</span> : null}
          {socialHandle(socials)}
        </a>
      ) : null}
    </div>
  );
}

function socialHandle(url: string) {
  const cleaned = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const segments = cleaned.split("/").filter(Boolean);
  return segments[segments.length - 1] || cleaned;
}

function ApprovedContact({ name, whatsapp, fallback }: { name?: string; whatsapp?: string; fallback: string }) {
  return (
    <div className="approved-contact">
      <MessageCircle size={15} />
      <span>
        <strong>{name ? `${name} WhatsApp` : "Approved contact"}</strong>
        {whatsapp ? <a href={whatsappHref(whatsapp)}>{whatsapp}</a> : <small>{fallback}</small>}
      </span>
    </div>
  );
}

function RunFactGrid({ run }: { run: CoreRun }) {
  return (
    <div className="run-meta-grid">
      <span>
        <CalendarClock size={15} />
        {formatRunStart(run.startTime)}
      </span>
      <span>{formatPace(run.paceSeconds)}/km</span>
      <span>{run.distanceKm} km</span>
      <span>{run.locationName}</span>
    </div>
  );
}

function PostRunScreen({
  city,
  profile,
  profileId,
  supabase,
  onBack,
  onMap,
  onPosted,
  onProfile
}: {
  city: CitySlug;
  profile: OnboardingDraft;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
  onBack: () => void;
  onMap: () => void;
  onPosted: () => void;
  onProfile: () => void;
}) {
  const [draft, setDraft] = useState<PostRunDraft>(() => ({
    startTime: defaultStartTime(),
    paceSeconds: profile.comfortable_pace_seconds_per_km,
    distanceKm: 7,
    intent: "social",
    locationName: "",
    pickedLat: null,
    pickedLng: null,
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locationNameTouched, setLocationNameTouched] = useState(false);

  // Reset pin when city changes — bounds differ.
  useEffect(() => {
    setDraft((current) => ({ ...current, pickedLat: null, pickedLng: null, locationName: "" }));
    setLocationNameTouched(false);
  }, [city]);

  function handlePickLocation(lat: number, lng: number) {
    setDraft((current) => ({ ...current, pickedLat: lat, pickedLng: lng }));
    setError("");
    if (locationNameTouched) return;
    reverseGeocode(lat, lng).then((name) => {
      if (!name) return;
      setDraft((current) => (current.pickedLat === lat && current.pickedLng === lng && !locationNameTouched
        ? { ...current, locationName: name }
        : current));
    });
  }

  async function submitRun() {
    if (!draft.startTime) {
      setError("Add a time to post your run.");
      return;
    }
    if (!draft.locationName.trim()) {
      setError("Add a location name.");
      return;
    }
    if (draft.pickedLat == null || draft.pickedLng == null) {
      setError("Tap the map to pick a start location.");
      return;
    }
    if (!isWithinCity(city, draft.pickedLat, draft.pickedLng)) {
      setError(`Pick a valid start location in ${CITY_CONFIG[city].label}.`);
      return;
    }
    if (!profileId || profileId === "preview-user") {
      setError("Sign in to post a run.");
      return;
    }

    setBusy(true);
    setError("");
    const result = await apiCreateRun(
      supabase,
      {
        city,
        title: titleFromIntent(draft.intent),
        locationName: draft.locationName.trim(),
        lat: draft.pickedLat,
        lng: draft.pickedLng,
        startTime: draft.startTime,
        paceSeconds: draft.paceSeconds,
        distanceKm: draft.distanceKm,
        intent: draft.intent,
        maxGroupSize: 3,
      },
      profileId
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Couldn't post run. Try again.");
      return;
    }
    onPosted();
    onMap();
  }

  return (
    <main className="app-shell matches-shell runs-shell">
      <BrandBar onProfile={onProfile} />
      <section className="post-run-panel" aria-label="Post a run">
        <button className="round-btn" onClick={onBack} aria-label="Back to runs">
          <ArrowLeft size={17} />
        </button>
        <header className="runs-header">
          <p className="modal-eyebrow">Post a run</p>
          <h1>Start one fast</h1>
          <p>Set the basics. Runners at your pace can request a spot.</p>
        </header>

        <div className="post-run-form">
          <label className="field-label">
            Time
            <input value={draft.startTime} type="datetime-local" onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))} />
          </label>
          <label className="field-label">
            Pace
            <input
              value={formatPace(draft.paceSeconds)}
              inputMode="numeric"
              onChange={(event) => setDraft((current) => ({ ...current, paceSeconds: parsePaceInput(event.target.value, current.paceSeconds) }))}
              placeholder="5:15"
            />
          </label>
          <label className="field-label">
            Distance km
            <input
              value={draft.distanceKm}
              type="number"
              min={1}
              step={0.5}
              onChange={(event) => setDraft((current) => ({ ...current, distanceKm: Number(event.target.value) }))}
            />
          </label>
          <div className="post-run-intent-field">
            <div className="post-run-intent-heading">
              <span>Intent</span>
              <p className="post-run-intent-lede">Pick what you&apos;re offering so the right runners tap in.</p>
            </div>
            <div className="post-run-intents" role="radiogroup" aria-label="Run intent">
              {postRunIntentChoices.map((choice) => {
                const selected = draft.intent === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`intent-pick${selected ? " intent-pick--active" : ""}`}
                    onClick={() => setDraft((current) => ({ ...current, intent: choice.value }))}
                  >
                    <span className="intent-pick-headline">{choice.headline}</span>
                    <span className="intent-pick-detail">{choice.detail}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field-label location-picker-field">
            <span>Location</span>
            <PostLocationPicker
              city={city}
              pickedLat={draft.pickedLat}
              pickedLng={draft.pickedLng}
              onPick={handlePickLocation}
            />
            <input
              value={draft.locationName}
              onChange={(event) => {
                setLocationNameTouched(true);
                setDraft((current) => ({ ...current, locationName: event.target.value }));
              }}
              placeholder="e.g. Ciutadella Park"
            />
            <small className="picker-hint">
              Tap the map to drop a pin. We&apos;ll auto-fill the name; edit to taste.
            </small>
          </div>
        </div>

        {error ? <p className="auth-notice">{error}</p> : null}

        <button className="primary-cta sticky-cta" onClick={submitRun} disabled={busy}>
          {busy ? "Posting..." : "Post run"}
        </button>
      </section>
      <RunionTabNav active="post" onMap={onMap} onPost={() => undefined} onRuns={onBack} />
    </main>
  );
}

function MatchedRunsMap({
  city,
  profile,
  profileId,
  supabase,
  requestedRunId,
  onRequest,
  onTuneProfile,
  onPostRun,
  onShowRuns,
  onProfile
}: {
  city: CitySlug;
  profile: OnboardingDraft;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
  requestedRunId: string;
  onRequest: (runId: string) => void;
  onTuneProfile: () => void;
  onPostRun: () => void;
  onShowRuns: () => void;
  onProfile: () => void;
}) {
  const cityConf = CITY_CONFIG[city];
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [activeFilter, setActiveFilter] = useState<MapRunFilter>("all");
  const [runsStatus, setRunsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [activeRunId, setActiveRunId] = useState("");
  const [sheetState, setSheetState] = useState<SheetState>("peek");
  const [dragY, setDragY] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number]>(cityConf.youLL);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [mapNotice, setMapNotice] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef({ active: false, moved: false, startY: 0, startSheetY: 0, currentY: 0 });
  const leafletRef = useRef<{
    map: import("leaflet").Map;
    youMarker: import("leaflet").Marker;
    markers: import("leaflet").Marker[];
  } | null>(null);
  const filteredRuns = useMemo(() => runs.filter((run) => runMatchesMapFilter(run, activeFilter)), [activeFilter, runs]);
  const activeRun = filteredRuns.find((run) => run.id === activeRunId) ?? filteredRuns[0];

  useEffect(() => {
    setUserLocation(cityConf.youLL);
    setLocationStatus("idle");
    leafletRef.current?.map.setView(cityConf.center, cityConf.zoom);
  }, [cityConf.center, cityConf.youLL, cityConf.zoom, city]);

  useEffect(() => {
    let cancelled = false;
    setRunsStatus("loading");
    const hasUserLoc = locationStatus === "found";
    const lat = hasUserLoc ? userLocation[0] : undefined;
    const lng = hasUserLoc ? userLocation[1] : undefined;
    fetchOpenRuns(supabase, { city, lat, lng, radiusM: 2000 })
      .then((rows) => {
        if (cancelled) return;
        setRuns(rows);
        setRunsStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setRunsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, city, locationStatus, userLocation, refreshKey]);

  // Subscribe to live changes for the current city. Best-effort: silent if
  // realtime isn't configured or the channel errors.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`runs:${city}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `city=eq.${city}` },
        () => setRefreshKey((k) => k + 1)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, city]);

  useEffect(() => {
    setActiveRunId((current) => (current && filteredRuns.some((run) => run.id === current) ? current : filteredRuns[0]?.id ?? ""));
  }, [filteredRuns]);

  useEffect(() => {
    let cancelled = false;

    async function bootMap() {
      if (!mapRef.current || leafletRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        center: cityConf.center,
        zoom: cityConf.zoom,
        zoomControl: false,
        attributionControl: false
      });

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19
      }).addTo(map);

      const youMarker = L.marker(userLocation, {
        icon: L.divIcon({
          className: "",
          html: '<div class="you-marker"><div class="you-pulse"></div><div class="you-dot"></div></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        }),
        interactive: false
      }).addTo(map);

      leafletRef.current = { map, youMarker, markers: [] };
      setMapReady(true);
      window.requestAnimationFrame(() => map.invalidateSize());
    }

    bootMap();

    return () => {
      cancelled = true;
    };
  }, [cityConf.center, cityConf.zoom, userLocation]);

  useEffect(() => {
    leafletRef.current?.youMarker.setLatLng(userLocation);
  }, [userLocation]);

  useEffect(() => {
    async function renderMarkers() {
      const state = leafletRef.current;
      if (!state || !mapReady) return;
      const L = await import("leaflet");

      state.markers.forEach((marker) => marker.remove());
      state.markers = filteredRuns.map((run) => {
        const active = run.id === activeRunId;
        const html = `
          <div class="runion-pin ${active ? "active" : ""} ${runOpenSpots(run) === 0 ? "full" : ""}">
            <div class="pin-glow"></div>
            <div class="mark">${run.paceMin}</div>
          </div>`;
        const marker = L.marker([run.lat, run.lng], {
          icon: L.divIcon({
            className: "",
            html,
            iconSize: active ? [60, 60] : [44, 44],
            iconAnchor: active ? [30, 30] : [22, 22]
          })
        }).addTo(state.map);
        marker.on("click", () => selectRun(run));
        return marker;
      });
    }

    renderMarkers();
  }, [activeRunId, filteredRuns, mapReady]);

  function selectRun(run: RunRow) {
    setActiveRunId(run.id);
    leafletRef.current?.map.flyTo([run.lat, run.lng], 14, { duration: 0.6 });
  }

  async function requestSpot(run: RunRow) {
    if (requestedRunId === run.id || runOpenSpots(run) === 0) return;
    if (!profileId || profileId === "preview-user") {
      setMapNotice("Sign in to request a spot.");
      return;
    }
    if (run.organiserId === profileId) {
      setMapNotice("That's your own run.");
      return;
    }
    const result = await apiRequestSpot(supabase, {
      runId: run.id,
      profileId,
      requesterName: profile.name?.trim() || "Runner",
      requesterWhatsapp: normalizeWhatsapp(profile.whatsapp),
      requesterSocials: profile.socials_url?.trim() ?? "",
    });
    if (result.ok) {
      onRequest(run.id);
      setMapNotice("Spot requested. Track it in Runs.");
      setRefreshKey((k) => k + 1);
    } else {
      setMapNotice(result.error || "Couldn't request spot. Try again.");
    }
  }

  function findMyLocation() {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unavailable");
      leafletRef.current?.map.flyTo(userLocation, 14, { duration: 0.7 });
      return;
    }

    setLocationStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation: [number, number] = [position.coords.latitude, position.coords.longitude];
        setUserLocation(nextLocation);
        setLocationStatus("found");
        leafletRef.current?.youMarker.setLatLng(nextLocation);
        leafletRef.current?.map.flyTo(nextLocation, 15, { duration: 0.7 });
      },
      (error) => {
        setLocationStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
        leafletRef.current?.map.flyTo(userLocation, 14, { duration: 0.7 });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000
      }
    );
  }

  function getSheetY(state: SheetState) {
    const height = sheetRef.current?.offsetHeight ?? Math.round(window.innerHeight * 0.68);

    if (state === "full") return 0;
    if (state === "hidden") return Math.max(0, height - 28);

    return Math.max(0, height - 270);
  }

  function snapSheet(y: number) {
    const closest = SHEET_STATES.reduce(
      (best, state) => {
        const distance = Math.abs(getSheetY(state) - y);
        return distance < best.distance ? { state, distance } : best;
      },
      { state: sheetState, distance: Number.POSITIVE_INFINITY }
    );

    setSheetState(closest.state);
    setDragY(null);
  }

  function toggleSheet() {
    const next: Record<SheetState, SheetState> = {
      hidden: "peek",
      peek: "full",
      full: "hidden"
    };

    setSheetState(next[sheetState]);
    setDragY(null);
  }

  function startSheetDrag(event: PointerEvent<HTMLElement | HTMLButtonElement>) {
    if (event.button !== 0) return;

    const startSheetY = dragY ?? getSheetY(sheetState);
    dragRef.current = {
      active: true,
      moved: false,
      startY: event.clientY,
      startSheetY,
      currentY: startSheetY
    };
    setDragY(startSheetY);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveSheetDrag(event: PointerEvent<HTMLElement | HTMLButtonElement>) {
    if (!dragRef.current.active) return;

    const maxY = getSheetY("hidden");
    const deltaY = event.clientY - dragRef.current.startY;
    const nextY = Math.min(maxY, Math.max(0, dragRef.current.startSheetY + deltaY));

    dragRef.current.currentY = nextY;
    dragRef.current.moved = dragRef.current.moved || Math.abs(deltaY) > 6;
    setDragY(nextY);
  }

  function endSheetDrag(event: PointerEvent<HTMLElement | HTMLButtonElement>) {
    if (!dragRef.current.active) return;

    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    snapSheet(dragRef.current.currentY);
  }

  function clickSheetChrome() {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }

    toggleSheet();
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <div className="logo" aria-label="runion">
          <LogoMark />
          runi<span>o</span>n
        </div>
        <div className="topbar-actions">
          <button
            className={`icon-btn ${locationStatus === "locating" ? "loading" : ""} ${locationStatus === "found" ? "found" : ""}`}
            aria-label="Find my location"
            onClick={findMyLocation}
            disabled={locationStatus === "locating"}
          >
            <LocateFixed size={17} />
          </button>
          <button className="icon-btn profile-icon-btn" aria-label="Open profile" onClick={onProfile}>
            <UserRound size={17} />
          </button>
        </div>
      </div>

      {locationStatus !== "idle" ? <div className={`location-toast ${locationStatus}`}>{locationStatusLabel(locationStatus)}</div> : null}
      {mapNotice ? <div className="location-toast found">{mapNotice}</div> : null}

      <div ref={mapRef} id="map" />

      <section
        ref={sheetRef}
        className={`sheet matched-sheet ${sheetState} ${dragY !== null ? "dragging" : ""}`}
        style={dragY !== null ? ({ "--sheet-drag-y": `${dragY}px` } as CSSProperties) : undefined}
        aria-label="Your matched runs this week"
      >
        <button
          className="drag-handle"
          aria-label="Toggle matched runs sheet"
          onClick={clickSheetChrome}
          onPointerDown={startSheetDrag}
          onPointerMove={moveSheetDrag}
          onPointerUp={endSheetDrag}
          onPointerCancel={endSheetDrag}
        />
        <header
          className="sheet-header"
          onClick={clickSheetChrome}
          onPointerDown={startSheetDrag}
          onPointerMove={moveSheetDrag}
          onPointerUp={endSheetDrag}
          onPointerCancel={endSheetDrag}
        >
          <p className="sheet-eyebrow">Matched, not random</p>
          <h1>
            {filteredRuns.length} runs near
            <br />
            <span>your pace</span>
          </h1>
          <p>{CITY_CONFIG[city].label} · runs near you</p>
        </header>

        <div className="filter-strip" aria-label="Run filters">
          {mapRunFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`fpill ${activeFilter === filter.value ? "active" : ""}`}
              aria-pressed={activeFilter === filter.value}
              onClick={() => setActiveFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {runsStatus === "loading" ? (
          <div className="run-list-empty">Loading runs near you…</div>
        ) : runsStatus === "error" ? (
          <div className="run-list-empty">Couldn&apos;t load runs. Try again.</div>
        ) : filteredRuns.length ? (
          <div className="run-list matched-run-list">
            {filteredRuns.map((run) => (
              <MatchedRunCard
                key={run.id}
                run={run}
                active={run.id === activeRunId}
                requested={run.id === requestedRunId}
                isHost={!!profileId && run.organiserId === profileId}
                onSelect={() => selectRun(run)}
                onRequest={() => requestSpot(run)}
              />
            ))}
          </div>
        ) : runs.length ? (
          <div className="run-list-empty">No runs match this filter yet.</div>
        ) : (
          <div className="run-list-empty">No runs nearby yet. Post the first one.</div>
        )}

        {activeRun ? (
          <div className="active-run-bar">
            <span>{activeRun.locationName}</span>
            <button className="text-btn" onClick={onTuneProfile}>
              Tune profile
            </button>
          </div>
        ) : null}
      </section>
      <RunionTabNav active="map" onMap={() => undefined} onPost={onPostRun} onRuns={onShowRuns} />
    </main>
  );
}

function RunionTabNav({
  active,
  onMap,
  onPost,
  onRuns
}: {
  active: RunsTab;
  onMap: () => void;
  onPost: () => void;
  onRuns: () => void;
}) {
  return (
    <nav className="bottom-nav runion-tabs" aria-label="Runion navigation">
      <button className={active === "map" ? "active" : ""} onClick={onMap} aria-current={active === "map" ? "page" : undefined}>
        <MapPin size={17} />
        Map
      </button>
      <button className={active === "post" ? "active" : ""} onClick={onPost} aria-current={active === "post" ? "page" : undefined}>
        <Plus size={17} />
        Post
      </button>
      <button className={active === "runs" ? "active" : ""} onClick={onRuns} aria-current={active === "runs" ? "page" : undefined}>
        <Check size={17} />
        Runs
      </button>
    </nav>
  );
}

function MatchedRunCard({
  run,
  active,
  requested,
  isHost,
  onSelect,
  onRequest
}: {
  run: RunRow;
  active: boolean;
  requested: boolean;
  isHost: boolean;
  onSelect: () => void;
  onRequest: () => void;
}) {
  const spots = runOpenSpots(run);
  const level = intentLabels[run.intent];
  const people = run.currentSpots <= 1 ? "1 runner" : `${run.currentSpots} runners`;

  return (
    <article className={`run-card matched-map-card ${active ? "active" : ""} ${requested ? "requested" : ""}`}>
      <button className="matched-card-main" onClick={onSelect}>
        <span className="match-topline">
          <span>{level}</span>
          <strong>
            {runDayLabel(run.startTime)} {runTimeLabel(run.startTime)}
          </strong>
        </span>
        <span className="run-card-top">
          <span>
            <strong>{run.title}</strong>
            <small>
              {run.distanceKm} KM · {runPaceLabel(run)}/KM · {people}
            </small>
          </span>
          <b>{run.paceMin}</b>
        </span>
        <span className="run-card-foot">
          <span>{level.toLowerCase()}</span>
          <span className="view-pill">{run.locationName}</span>
        </span>
      </button>
      <button
        className="detail-cta request-spot-btn"
        onClick={onRequest}
        disabled={isHost || requested || !spots}
      >
        {isHost ? "You're hosting this run" : requested ? "Spot requested" : spots === 1 ? "Request spot - 1 left" : "Request spot"}
      </button>
      {requested ? <div className="success-state">Spot requested. We&apos;ll confirm your match soon.</div> : null}
    </article>
  );
}

function runMatchesMapFilter(run: RunRow, filter: MapRunFilter) {
  if (filter === "all") return true;
  if (filter === "pace_500_530") return run.paceSeconds >= 300 && run.paceSeconds <= 330;
  if (filter === "pace_530_600") return run.paceSeconds >= 330 && run.paceSeconds <= 360;
  if (filter === "social") return run.intent === "social";
  if (filter === "tempo") return run.intent === "tempo";
  return true;
}

function locationStatusLabel(status: LocationStatus) {
  const labels: Record<LocationStatus, string> = {
    idle: "",
    locating: "Finding your location...",
    found: "Location found",
    denied: "Location permission denied",
    unavailable: "Location unavailable"
  };

  return labels[status];
}

function BrandBar({ onProfile }: { onProfile?: () => void }) {
  return (
    <div className="topbar">
      <div className="logo" aria-label="runion">
        <LogoMark />
        runi<span>o</span>n
      </div>
      {onProfile ? (
        <button className="icon-btn profile-icon-btn" aria-label="Open profile" onClick={onProfile}>
          <UserRound size={17} />
        </button>
      ) : null}
    </div>
  );
}

function Question({ title, detail }: { title: string; detail?: string }) {
  return (
    <header className="question">
      <p className="modal-eyebrow">Runner profile</p>
      <h1>{title}</h1>
      {detail ? <span>{detail}</span> : null}
    </header>
  );
}

function OptionStack({
  options,
  onSelect
}: {
  options: { value: string; label: string; detail?: string; active: boolean }[];
  onSelect: (value: string) => void;
}) {
  return (
    <div className="option-stack">
      {options.map((option) => (
        <button key={option.value} className={`choice ${option.active ? "active" : ""}`} onClick={() => onSelect(option.value)}>
          <span>
            <strong>{option.label}</strong>
            {option.detail ? <small>{option.detail}</small> : null}
          </span>
          {option.active ? <Check size={17} /> : null}
        </button>
      ))}
    </div>
  );
}


function hasRunActivity(activity: { pending: RunParticipantActivity[]; confirmed: RunParticipantActivity[]; hosted: HostedRunActivity[] }) {
  return activity.pending.length > 0 || activity.confirmed.length > 0 || activity.hosted.length > 0;
}

function titleFromIntent(intent: CoreIntent) {
  if (intent === "tempo") return "Tempo run";
  if (intent === "consistency") return "Consistency run";
  return "Social run";
}

function normalizeIntent(value?: string): CoreIntent {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("tempo") || lower.includes("performance") || lower.includes("speed") || lower.includes("event") || lower.includes("hill")) return "tempo";
  if (lower.includes("routine") || lower.includes("consistent") || lower.includes("steady") || lower.includes("accountable")) return "consistency";
  return "social";
}

function normalizeParticipantStatus(value?: string): ParticipantStatus | null {
  if (value === "requested" || value === "confirmed" || value === "declined") return value;
  if (value === "pending") return "requested";
  return null;
}

function profileIntentToCoreIntent(intent: RunIntent): CoreIntent {
  if (intent === "improve_speed" || intent === "train_event") return "tempo";
  if (intent === "build_routine" || intent === "increase_distance" || intent === "stay_accountable") return "consistency";
  return "social";
}

function availabilityMatches(startTime: string, availability: RunAvailability[]) {
  const date = new Date(startTime);
  const hour = date.getHours();
  const day = date.getDay();
  if (availability.includes("weekends") && (day === 0 || day === 6)) return true;
  if (availability.includes("morning") && hour < 12) return true;
  if (availability.includes("evening") && hour >= 17) return true;
  return availability.length === 0;
}

function participantLabel(name: string, count: number) {
  if (count <= 1) return name;
  if (count === 2) return `${name} + 1 runner`;
  return `${name} + ${count - 1} runners`;
}

function formatRunStart(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { weekday: "short" }) + " " + date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function runRowToCoreRun(run: RunRow): CoreRun {
  return {
    id: run.id,
    city: run.city,
    title: run.title,
    description: run.description ?? undefined,
    paceSeconds: run.paceSeconds,
    paceMin: run.paceMin,
    paceMax: run.paceMax,
    distanceKm: run.distanceKm,
    startTime: run.startTime,
    locationName: run.locationName,
    intent: run.intent,
    participants: participantLabel("Host", run.currentSpots),
    maxGroupSize: run.maxGroupSize,
    currentSpots: run.currentSpots,
    status: run.status,
    source: "db",
  };
}

function participantRowToActivity(p: ParticipantRow, run: CoreRun, fallbackProfile: OnboardingDraft): RunParticipantActivity {
  return {
    id: p.id,
    run,
    status: p.status as ParticipantStatus,
    requesterName: p.requesterName ?? fallbackProfile.name ?? "Runner",
    requesterWhatsapp: p.requesterWhatsapp ?? undefined,
    requesterSocials: p.requesterSocials ?? undefined,
    requesterPace: fallbackProfile.comfortable_pace_seconds_per_km,
    requesterIntent: profileIntentToCoreIntent(fallbackProfile.run_intents[0] ?? "find_partners"),
    createdAt: p.createdAt,
  };
}

function adaptMyActivity(
  raw: import("@/lib/api/runs").MyActivity,
  profile: OnboardingDraft
): { pending: RunParticipantActivity[]; confirmed: RunParticipantActivity[]; hosted: HostedRunActivity[] } {
  const pending = raw.pending.map(({ participant, run }) => participantRowToActivity(participant, runRowToCoreRun(run), profile));
  const confirmed = raw.confirmed.map(({ participant, run }) => participantRowToActivity(participant, runRowToCoreRun(run), profile));
  const hosted: HostedRunActivity[] = raw.hosted.map(({ run, pending: pendingRows, confirmed: confirmedRows }) => {
    const core = runRowToCoreRun(run);
    return {
      run: core,
      confirmedCount: confirmedRows.length,
      confirmedRequests: confirmedRows.map((p) => participantRowToActivity(p, core, profile)),
      pendingRequests: pendingRows.map((p) => participantRowToActivity(p, core, profile)),
    };
  });
  return { pending, confirmed, hosted };
}

function PostLocationPicker({
  city,
  pickedLat,
  pickedLng,
  onPick,
}: {
  city: CitySlug;
  pickedLat: number | null;
  pickedLng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    map: import("leaflet").Map;
    pin: import("leaflet").Marker | null;
  } | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const cityConf = CITY_CONFIG[city];

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!containerRef.current || stateRef.current) return;
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;
      const map = L.map(containerRef.current, {
        center: cityConf.center,
        zoom: cityConf.zoom,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      map.on("click", (event) => {
        const { lat, lng } = event.latlng;
        onPickRef.current(lat, lng);
      });
      stateRef.current = { map, pin: null };
      window.requestAnimationFrame(() => map.invalidateSize());
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [cityConf.center, cityConf.zoom]);

  // Re-center on city change.
  useEffect(() => {
    stateRef.current?.map.setView(cityConf.center, cityConf.zoom);
  }, [cityConf.center, cityConf.zoom]);

  // Render pin.
  useEffect(() => {
    let cancelled = false;
    async function renderPin() {
      const state = stateRef.current;
      if (!state) return;
      const L = await import("leaflet");
      if (cancelled) return;
      if (state.pin) {
        state.pin.remove();
        state.pin = null;
      }
      if (pickedLat != null && pickedLng != null) {
        state.pin = L.marker([pickedLat, pickedLng], {
          icon: L.divIcon({
            className: "",
            html: '<div class="picker-pin"><div class="picker-pin-dot"></div></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
          interactive: false,
        }).addTo(state.map);
        state.map.panTo([pickedLat, pickedLng]);
      }
    }
    renderPin();
    return () => {
      cancelled = true;
    };
  }, [pickedLat, pickedLng]);

  return <div ref={containerRef} className="post-run-map" />;
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=1`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { name?: string; display_name?: string; address?: Record<string, string> };
    const addr = data.address ?? {};
    const candidate =
      addr.attraction ||
      addr.park ||
      addr.leisure ||
      addr.tourism ||
      addr.road ||
      addr.suburb ||
      addr.neighbourhood ||
      data.name ||
      data.display_name?.split(",")[0];
    return candidate?.trim() || null;
  } catch {
    return null;
  }
}

function defaultStartTime() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(7, 0, 0, 0);
  return toDatetimeLocal(date);
}

function toDatetimeLocal(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parsePaceInput(value: string, fallback: number) {
  const parsed = secondsFromPace(value);
  return parsed ? clampPace(parsed) : fallback;
}

function secondsFromPace(value: string) {
  const [minutes, seconds = "0"] = value.split(":");
  const total = Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function secondsFromValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  if (/^\d+:\d{2}$/.test(value)) return secondsFromPace(value);
  const parts = value.split(":").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function numberFromValue(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function secondsToInterval(seconds: number) {
  return `00:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function legacyStartTime(row: Record<string, unknown>) {
  const date = firstString(row, ["run_date"]);
  const time = firstString(row, ["time"]);
  if (!date || !time) return null;
  return `${date}T${time}`;
}

function toggleValue<T>(values: T[], value: T) {
  if (values.includes(value)) {
    const next = values.filter((item) => item !== value);
    return next.length ? next : values;
  }
  return [...values, value];
}

function formatPace(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function clampPace(seconds: number) {
  return Math.min(420, Math.max(270, seconds));
}

function paceRangeFromCenter(seconds: number) {
  const center = clampPace(seconds);
  return {
    min: clampPace(center - 15),
    max: clampPace(center + 15)
  };
}

function normalizePaceRange(profile: Pick<RunnerProfile, "comfortable_pace_seconds_per_km" | "comfortable_pace_min_seconds_per_km" | "comfortable_pace_max_seconds_per_km">) {
  const fallback = paceRangeFromCenter(profile.comfortable_pace_seconds_per_km);
  const rawMin = clampPace(profile.comfortable_pace_min_seconds_per_km ?? fallback.min);
  const rawMax = clampPace(profile.comfortable_pace_max_seconds_per_km ?? fallback.max);
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);

  return {
    min,
    max,
    center: Math.round((min + max) / 2)
  };
}

function isMissingPaceRangeColumnError(message: string) {
  return message.includes("comfortable_pace_min_seconds_per_km") || message.includes("comfortable_pace_max_seconds_per_km");
}

function normalizeWhatsapp(value?: string) {
  return value?.trim() ?? "";
}

function whatsappHref(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "#";
}

function initialsFromName(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function readPreviewProfile(): RunnerProfile | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RunnerProfile) : null;
  } catch {
    return null;
  }
}

function cityFromHash(hash: string): CitySlug | null {
  const slug = hash.replace(/^#/, "").toLowerCase();
  return slug in CITY_CONFIG ? (slug as CitySlug) : null;
}

function getAuthProfile(metadata: Record<string, unknown> | null | undefined) {
  const name = firstString(metadata, ["full_name", "name"]);
  const photoUrl = firstString(metadata, ["avatar_url", "picture"]);

  return { name, photoUrl };
}

function firstString(source: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  return undefined;
}

function LogoMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline SVG asset from /public
    <img className="logo-icon" src="/runion-icon.svg" alt="" aria-hidden="true" />
  );
}

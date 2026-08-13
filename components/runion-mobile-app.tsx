"use client";

import "leaflet/dist/leaflet.css";

import { ArrowLeft, CalendarClock, Camera, Check, ChevronDown, Footprints, LocateFixed, Lock, LogOut, Mail, MapPin, MessageCircle, Plus, Save, Sparkles, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, PointerEvent, ReactNode, SetStateAction } from "react";
import type { CitySlug, PreferredGroupSize, RunAvailability, RunIntent, RunnerProfile, RunnerType } from "@/lib/types";
import { authSiteUrl } from "@/lib/auth-site-url";
import { CITY_CONFIG } from "@/lib/config";
import { captureUtm, stampSignupUtm } from "@/lib/utm";
import {
  cancelOwnRequest as apiCancelOwnRequest,
  cancelRun as apiCancelRun,
  createRun as apiCreateRun,
  detectSocialsPlatform,
  fetchMyActivity as apiFetchMyActivity,
  fetchOpenRuns,
  fetchUserStatsBatch as apiFetchUserStatsBatch,
  isValidSocialsUrl,
  normalizeSocialsInput,
  openSpots as runOpenSpots,
  paceLabel as runPaceLabel,
  requestSpot as apiRequestSpot,
  setJoinerReview as apiSetJoinerReview,
  setRequestStatus as apiSetRequestStatus,
  wrapUpRun as apiWrapUpRun,
  dayLabel as runDayLabel,
  timeLabel as runTimeLabel,
  type HostOutcome,
  type ParticipantRow,
  type ParticipantStatus as ApiParticipantStatus,
  type RunRow,
  type UserStats,
} from "@/lib/api/runs";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/uploadAvatar";

type Props = {
  initialCity: CitySlug;
};

type AuthMode = "magic" | "password";
type AppState = "loading" | "auth" | "onboarding" | "runs";
type SheetState = "hidden" | "peek" | "full";
type LocationStatus = "idle" | "locating" | "found" | "denied" | "unavailable";
type MapRunFilter = "all" | "near_me" | "my_pace" | "today" | "has_space" | "social" | "tempo";

const NEAR_ME_RADIUS_M = 2000;

type OnboardingDraft = Omit<RunnerProfile, "onboarding_completed">;
type CoreIntent = "tempo" | "social";
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
  organiserId?: string;
  organiserName?: string;
  organiserSocials?: string;
  organiserRunnerType?: string;
  organiserRunIntents?: string[];
  organiserCompletedRuns?: number;
  recurrence?: "weekly" | null;
  womenOnly?: boolean;
  source: "db" | "mock" | "local";
};

type RunParticipantActivity = {
  id: string;
  userId: string;
  run: CoreRun;
  status: ParticipantStatus;
  requesterName: string;
  requesterWhatsapp?: string;
  requesterSocials?: string;
  requesterPace?: number;
  requesterIntent?: CoreIntent;
  joinerRunAgain?: boolean | null;
  joinerReviewedAt?: string | null;
  hostOrganiserId?: string;
  hostName?: string;
  hostWhatsapp?: string;
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
  recurring: boolean;
  womenOnly: boolean;
  note: string;
};

const RUN_NOTE_MAX = 140;
const INTENT_MAX = 3;
const SEEN_ACTIVITY_KEY = "runion.seenActivity";

// City picker. Live cities are switchable; coming-soon are display-only
// (slug null = no map config yet). Order: live first, then soon.
const CITY_PICKER: { slug: CitySlug | null; label: string; live: boolean }[] = [
  { slug: "bcn", label: "Barcelona", live: true },
  { slug: "sg", label: "Singapore", live: true },
  { slug: "ber", label: "Berlin", live: true },
  { slug: "par", label: "Paris", live: false },
  { slug: null, label: "Rome", live: false },
  { slug: null, label: "New York", live: false },
];

function readSeenActivity(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_ACTIVITY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeSeenActivity(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_ACTIVITY_KEY, JSON.stringify(ids));
  } catch {
    // Ignore quota / privacy-mode errors — the badge just won't persist.
  }
}

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
const REPORT_CONTACT_WHATSAPP = "+6581174827";
const REPORT_CONTACT_PREFILL = "Hi runion team, I want to report an issue:";
const SHEET_STATES: SheetState[] = ["hidden", "peek", "full"];
const intentLabels: Record<CoreIntent, string> = {
  tempo: "TEMPO",
  social: "SOCIAL"
};

const postRunIntentChoices: { value: CoreIntent; headline: string; detail: string }[] = [
  { value: "tempo", headline: "TEMPO", detail: "Quality work — harder pace or intervals." },
  { value: "social", headline: "SOCIAL", detail: "Easy miles and conversation." }
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
  { value: "all", label: "All" },
  { value: "near_me", label: "Near me" },
  { value: "my_pace", label: "My pace" },
  { value: "today", label: "Today" },
  { value: "has_space", label: "Has space" },
  { value: "social", label: "Social" },
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
  const [runsBadge, setRunsBadge] = useState(0);

  useEffect(() => {
    function syncCityFromHash() {
      const hashCity = cityFromHash(window.location.hash);
      if (hashCity) setCity(hashCity);
    }

    syncCityFromHash();
    window.addEventListener("hashchange", syncCityFromHash);
    return () => window.removeEventListener("hashchange", syncCityFromHash);
  }, []);

  // First-touch attribution: stash any utm_* params from the landing URL so we
  // can stamp them onto the user's row when they finish onboarding.
  useEffect(() => {
    captureUtm();
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

  // Badge on the "My runs" nav icon. Counts actionable activity the user
  // hasn't acknowledged yet: incoming requests on runs they host, and their
  // own requests that a host has approved. Visiting /runs clears it.
  useEffect(() => {
    if (!supabase || !profileId || profileId === "preview-user") {
      setRunsBadge(0);
      return;
    }
    let cancelled = false;
    async function refreshBadge() {
      const raw = await apiFetchMyActivity(supabase!, { profileId: profileId! });
      if (cancelled) return;
      const ids = [
        ...raw.confirmed.map((c) => `confirmed:${c.participant.id}`),
        ...raw.hosted.flatMap((h) => h.pending.map((p) => `incoming:${p.id}`)),
      ];
      const seen = readSeenActivity();
      if (pathname === "/runs") {
        // On the runs screen everything is acknowledged.
        writeSeenActivity(ids);
        setRunsBadge(0);
      } else {
        setRunsBadge(ids.filter((id) => !seen.includes(id)).length);
      }
    }
    refreshBadge();
    const interval = window.setInterval(refreshBadge, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [supabase, profileId, pathname]);

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
    const cleanedSocials = normalizeSocialsInput(profile.socials_url ?? "");
    if (!cleanedSocials) {
      return { ok: false, message: "Add a Strava, Instagram, or Garmin link (or just your Instagram handle)." };
    }
    if (!isValidSocialsUrl(cleanedSocials)) {
      return { ok: false, message: "Use a Strava, Instagram, or Garmin link, or just your Instagram handle." };
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
      void stampSignupUtm(supabase, profileId);
      setDraft(nextProfile);
      return { ok: true, message: "" };
    }

    if (error) return { ok: false, message: error.message };

    void stampSignupUtm(supabase, profileId);
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
      options: { redirectTo: `${authSiteUrl()}/auth/callback` }
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
    const redirectTo = `${authSiteUrl()}/auth/callback`;

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
    if (!/invalid login credentials/i.test(signIn.error.message)) {
      setAuthNotice(signIn.error.message);
      setAuthBusy(false);
      return;
    }

    const signUp = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
    if (signUp.error) {
      if (/already registered|user already exists/i.test(signUp.error.message)) {
        setAuthNotice("This email is already registered — the password didn't match. Try again, or sign in with a magic link.");
      } else {
        setAuthNotice(signUp.error.message);
      }
      setAuthBusy(false);
      return;
    }

    // Supabase's email-enumeration protection: an existing confirmed user
    // returns a user object with an empty identities array and no session.
    const identities = signUp.data.user?.identities ?? null;
    if (identities && identities.length === 0) {
      setAuthNotice("This email is already registered — the password didn't match. Try again, or sign in with a magic link.");
      setAuthBusy(false);
      return;
    }

    if (!signUp.data.session) {
      setAuthNotice("Account created. Check your inbox to confirm your email before signing in.");
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
    const cleanedSocials = normalizeSocialsInput(draft.socials_url ?? "");
    if (!cleanedSocials) {
      setAuthNotice("Add a Strava, Instagram, or Garmin link (or just your Instagram handle).");
      return;
    }
    if (!isValidSocialsUrl(cleanedSocials)) {
      setAuthNotice("Use a Strava, Instagram, or Garmin link, or just your Instagram handle.");
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

    void stampSignupUtm(supabase, profileId);
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
            <h1>Run with the neighbour you haven&apos;t met.</h1>
            <p>Curated 1-on-1 and small-group runs, ten minutes from your door.</p>
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

          <OnboardingStep step={step} draft={draft} setDraft={setDraft} profileId={profileId} supabase={supabase} />

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
        onRuns={() => router.push(`/runs#${city}`)}
        onPosted={() => {
          router.push(`/runs#${city}`);
        }}
        onProfile={() => router.push(`/profile#${city}`)}
        runsBadge={runsBadge}
      />
    );
  }

  if (pathname === "/profile") {
    return (
      <ProfileScreen
        profile={draft}
        email={profileEmail}
        profileId={profileId}
        supabase={supabase}
        onProfileChange={setDraft}
        onBack={() => router.push(`/runs#${city}`)}
        onMap={() => router.push(`/map#${city}`)}
        onPostRun={() => router.push(`/post-run#${city}`)}
        onRuns={() => router.push(`/runs#${city}`)}
        onSave={saveProfileChanges}
        onSignOut={signOut}
        runsBadge={runsBadge}
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
        onPostRun={() => router.push(`/post-run#${city}`)}
        onShowRuns={() => router.push(`/runs#${city}`)}
        onProfile={() => router.push(`/profile#${city}`)}
        onCityChange={(slug) => {
          setCity(slug);
          router.push(`/map#${slug}`);
        }}
        runsBadge={runsBadge}
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
  setDraft,
  profileId,
  supabase
}: {
  step: number;
  draft: OnboardingDraft;
  setDraft: Dispatch<SetStateAction<OnboardingDraft>>;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
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
    const minPercent = ((paceRange.min - 180) / 300) * 100;
    const maxPercent = ((paceRange.max - 180) / 300) * 100;

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
              min={180}
              max={480}
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
              min={180}
              max={480}
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
            <span>3:00</span>
            <span>8:00</span>
          </div>
        </div>
        <p className="step-hint">Approximate is fine — you can update it anytime in your profile.</p>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="step-card">
        <Question title="Why do you want to run with others?" detail={`Pick up to ${INTENT_MAX} — keeps your matches sharp.`} />
        <OptionStack
          options={intents.map((item) => ({ value: item.value, label: item.label, detail: item.detail, active: draft.run_intents.includes(item.value) }))}
          onSelect={(value) =>
            setDraft((current) => ({
              ...current,
              run_intents: toggleValueMax(current.run_intents, value as RunIntent, INTENT_MAX)
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
      <AvatarPicker
        photoUrl={draft.profile_photo_url}
        profileId={profileId}
        supabase={supabase}
        onChange={(url) => setDraft((current) => ({ ...current, profile_photo_url: url }))}
      />
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
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="url"
            spellCheck={false}
            placeholder="Strava/Garmin link, or your Instagram @handle"
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
  const [stats, setStats] = useState<Record<string, UserStats>>({});
  const [activity, setActivity] = useState<{ pending: RunParticipantActivity[]; confirmed: RunParticipantActivity[]; pastConfirmed: RunParticipantActivity[]; hosted: HostedRunActivity[]; pastHosted: HostedRunActivity[] }>({
    pending: [],
    confirmed: [],
    pastConfirmed: [],
    hosted: [],
    pastHosted: []
  });
  const [recapTarget, setRecapTarget] = useState<HostedRunActivity | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadRuns() {
      setLoading(true);
      if (!profileId || profileId === "preview-user") {
        if (mounted) {
          setActivity({ pending: [], confirmed: [], pastConfirmed: [], hosted: [], pastHosted: [] });
          setLoading(false);
        }
        return;
      }
      const raw = await apiFetchMyActivity(supabase, { profileId });
      if (!mounted) return;
      setActivity(adaptMyActivity(raw, profile));
      setLoading(false);
      const ids = collectStatIds(raw, profileId);
      if (ids.length) {
        const next = await apiFetchUserStatsBatch(supabase, ids);
        if (mounted) setStats(next);
      }
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
    const ids = collectStatIds(raw, profileId);
    if (ids.length) {
      const next = await apiFetchUserStatsBatch(supabase, ids);
      setStats(next);
    }
  }

  async function handleJoinerReview(participantId: string, runAgain: boolean) {
    const result = await apiSetJoinerReview(supabase, { participantId, runAgain });
    if (result.ok) await refreshActivity(runAgain ? "Thanks — saved." : "Saved.");
    else setToast(result.error || "Couldn't save feedback. Try again.");
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

  async function handleWrapUp(hosted: HostedRunActivity, outcomes: { participantId: string; outcome: HostOutcome; runAgain: boolean }[]) {
    const result = await apiWrapUpRun(supabase, { runId: hosted.run.id, outcomes });
    if (result.ok) {
      setRecapTarget(null);
      await refreshActivity("Run wrapped up.");
    } else {
      setToast(result.error || "Couldn't wrap up the run. Try again.");
    }
  }

  async function handleCancel(hosted: HostedRunActivity) {
    const reason = window.prompt("Reason for cancelling? (weather, no-shows, can't make it, ...)") ?? "";
    if (!reason.trim()) return;
    const result = await apiCancelRun(supabase, { runId: hosted.run.id, reason: reason.trim() });
    if (result.ok) {
      await refreshActivity("Run cancelled.");
    } else {
      setToast(result.error || "Couldn't cancel the run. Try again.");
    }
  }

  return (
    <main className="app-shell matches-shell runs-shell">
      <BrandBar
        page="runs"
        onLogo={onOpenMap}
        onMap={onOpenMap}
        onPostRun={onPostRun}
        onProfile={onProfile}
      />
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
                <ActivityRunCard
                  key={item.id}
                  item={item}
                  badge="Confirmed"
                  note={item.run.participants}
                  hostStats={item.hostOrganiserId ? stats[item.hostOrganiserId] : undefined}
                  viewerName={profile.name}
                  showApprovedContact
                />
              ))}
            </ActivitySection>

            <ActivitySection title="Pending requests" empty="No pending requests.">
              {activity.pending.map((item) => (
                <ActivityRunCard
                  key={item.id}
                  item={item}
                  badge="Requested"
                  note="Waiting for host approval"
                  onWithdraw={() => {
                    if (window.confirm(`Withdraw your request to join ${item.run.title}?`)) {
                      updateRequestStatus(item, "requested");
                    }
                  }}
                />
              ))}
            </ActivitySection>

            <ActivitySection title="Your posted runs" empty="No posted runs yet.">
              {activity.hosted.map((hosted) => (
                <HostedRunCard
                  key={hosted.run.id}
                  hosted={hosted}
                  stats={stats}
                  hostName={profile.name}
                  onApprove={(request) => updateRequestStatus(request, "confirmed")}
                  onDecline={(request) => updateRequestStatus(request, "declined")}
                  onWrapUp={(h) => setRecapTarget(h)}
                  onCancel={handleCancel}
                />
              ))}
            </ActivitySection>

            {activity.pastConfirmed.length ? (
              <ActivitySection title="Past runs you joined" empty="">
                {activity.pastConfirmed.map((item) => (
                  <JoinedPastCard
                    key={item.id}
                    item={item}
                    hostStats={item.hostOrganiserId ? stats[item.hostOrganiserId] : undefined}
                    onAnswer={(again) => handleJoinerReview(item.id, again)}
                  />
                ))}
              </ActivitySection>
            ) : null}

            {activity.pastHosted.length ? (
              <ActivitySection title="Past runs" empty="">
                {activity.pastHosted.map((hosted) => (
                  <HostedRunCard
                    key={hosted.run.id}
                    hosted={hosted}
                    stats={stats}
                    hostName={profile.name}
                    onApprove={(request) => updateRequestStatus(request, "confirmed")}
                    onDecline={(request) => updateRequestStatus(request, "declined")}
                  />
                ))}
              </ActivitySection>
            ) : null}
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
      {recapTarget ? (
        <RecapModal
          hosted={recapTarget}
          onClose={() => setRecapTarget(null)}
          onSave={(outcomes) => handleWrapUp(recapTarget, outcomes)}
        />
      ) : null}
    </main>
  );
}

function ProfileScreen({
  profile,
  email,
  profileId,
  supabase,
  onProfileChange,
  onBack,
  onMap,
  onPostRun,
  onRuns,
  onSave,
  onSignOut,
  runsBadge = 0
}: {
  profile: OnboardingDraft;
  email?: string;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
  onProfileChange: Dispatch<SetStateAction<OnboardingDraft>>;
  onBack: () => void;
  onMap: () => void;
  onPostRun: () => void;
  onRuns: () => void;
  onSave: (profile: OnboardingDraft) => Promise<{ ok: boolean; message: string }>;
  onSignOut: () => Promise<void>;
  runsBadge?: number;
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
      <BrandBar
        page="profile"
        onLogo={onMap}
        onMap={onMap}
        onPostRun={onPostRun}
        onRuns={onRuns}
        runsBadge={runsBadge}
      />
      <section className="profile-panel" aria-label="Profile">
        <button className="round-btn" onClick={onBack} aria-label="Back to runs">
          <ArrowLeft size={17} />
        </button>
        <header className="runs-header profile-header">
          <p className="modal-eyebrow">RUNION</p>
          <h1>Profile</h1>
          <p>Keep your running preferences up to date.</p>
        </header>

        <section className="profile-identity profile-identity--picker" aria-label="Profile identity">
          <AvatarPicker
            photoUrl={localProfile.profile_photo_url}
            profileId={profileId}
            supabase={supabase}
            onChange={(url) => {
              setLocalProfile((current) => ({ ...current, profile_photo_url: url }));
              onProfileChange((current) => ({ ...current, profile_photo_url: url }));
            }}
            fallbackInitials={initialsFromName(localProfile.name || email || "Runner")}
          />
          <div>
            <strong>{localProfile.name || "Runner"}</strong>
            <span>{localProfile.profile_photo_url ? "Tap photo to change" : "Tap to add a photo"}</span>
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
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="url"
                spellCheck={false}
                placeholder="Strava/Garmin link, or your Instagram @handle"
              />
            </span>
            <span className="privacy-note">Helps people understand who they&apos;re running with. Hosts see this when you request a spot.</span>
          </label>

          <ProfilePaceRangeField profile={localProfile} setProfile={setLocalProfile} />

          <ProfileChoiceGroup title="Runner type">
            <OptionStack
              options={runnerTypes.map((item) => ({ value: item.value, label: item.label, active: localProfile.runner_type === item.value }))}
              onSelect={(value) => setLocalProfile((current) => ({ ...current, runner_type: value as RunnerType }))}
            />
          </ProfileChoiceGroup>

          <ProfileChoiceGroup title={`Intent (up to ${INTENT_MAX})`}>
            <OptionStack
              options={intents.map((item) => ({ value: item.value, label: item.label, detail: item.detail, active: localProfile.run_intents.includes(item.value) }))}
              onSelect={(value) =>
                setLocalProfile((current) => ({
                  ...current,
                  run_intents: toggleValueMax(current.run_intents, value as RunIntent, INTENT_MAX)
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
          <a
            className="report-link"
            href={whatsappHref(REPORT_CONTACT_WHATSAPP, REPORT_CONTACT_PREFILL)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={15} />
            Report a problem or contact runion
          </a>
          <button className="logout-cta" onClick={onSignOut}>
            <LogOut size={17} />
            Log out
          </button>
        </div>
      </section>
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

function ProfilePaceRangeField({
  profile,
  setProfile,
}: {
  profile: OnboardingDraft;
  setProfile: Dispatch<SetStateAction<OnboardingDraft>>;
}) {
  const paceRange = normalizePaceRange(profile);
  const minPercent = ((paceRange.min - 180) / 300) * 100;
  const maxPercent = ((paceRange.max - 180) / 300) * 100;
  return (
    <label className="field-label">
      Comfortable pace range
      <div className="pace-readout" aria-live="polite">
        <span>{formatPace(paceRange.min)}-{formatPace(paceRange.max)}</span>
        <small>/km</small>
      </div>
      <div
        className="onboarding-pace-range"
        style={
          {
            "--pace-min": `${minPercent}%`,
            "--pace-max": `${maxPercent}%`,
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
            min={180}
            max={480}
            step={15}
            value={paceRange.min}
            onChange={(event) =>
              setProfile((current) => {
                const currentRange = normalizePaceRange(current);
                const min = Number(event.target.value);
                const max = Math.max(min, currentRange.max);
                return {
                  ...current,
                  comfortable_pace_seconds_per_km: Math.round((min + max) / 2),
                  comfortable_pace_min_seconds_per_km: min,
                  comfortable_pace_max_seconds_per_km: max,
                };
              })
            }
          />
          <input
            aria-label="Maximum comfortable pace"
            type="range"
            min={180}
            max={480}
            step={15}
            value={paceRange.max}
            onChange={(event) =>
              setProfile((current) => {
                const currentRange = normalizePaceRange(current);
                const max = Number(event.target.value);
                const min = Math.min(currentRange.min, max);
                return {
                  ...current,
                  comfortable_pace_seconds_per_km: Math.round((min + max) / 2),
                  comfortable_pace_min_seconds_per_km: min,
                  comfortable_pace_max_seconds_per_km: max,
                };
              })
            }
          />
        </div>
        <div className="slider-labels">
          <span>3:00</span>
          <span>8:00</span>
        </div>
      </div>
    </label>
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
  hostStats,
  viewerName,
  showApprovedContact = false,
  onWithdraw
}: {
  item: RunParticipantActivity;
  badge: string;
  note: string;
  hostStats?: UserStats;
  viewerName?: string;
  showApprovedContact?: boolean;
  onWithdraw?: () => void;
}) {
  return (
    <article className="activity-card">
      <div className="activity-card-head">
        <span className="status-badge">{badge}</span>
        {onWithdraw ? (
          <button className="text-btn" onClick={onWithdraw}>
            Withdraw
          </button>
        ) : null}
      </div>
      <h3>{item.run.title}</h3>
      <RunFactGrid run={item.run} />
      <p className="activity-note">{note}</p>
      <StatsBadge stats={hostStats} />
      {showApprovedContact ? (
        <HostContact
          hostName={item.hostName}
          hostWhatsapp={item.hostWhatsapp}
          run={item.run}
          viewerName={viewerName}
        />
      ) : null}
    </article>
  );
}

function HostContact({
  hostName,
  hostWhatsapp,
  run,
  viewerName,
}: {
  hostName?: string;
  hostWhatsapp?: string;
  run: CoreRun;
  viewerName?: string;
}) {
  if (!hostWhatsapp) {
    return (
      <div className="approved-contact">
        <MessageCircle size={15} />
        <span>
          <strong>{hostName ? `${hostName} (host)` : "Host"}</strong>
          <small>Host hasn&apos;t shared WhatsApp yet — they&apos;ll reach out to you.</small>
        </span>
      </div>
    );
  }
  const text = buildRunWhatsappMessage({ run, senderName: viewerName, recipientName: hostName });
  return (
    <div className="approved-contact">
      <MessageCircle size={15} />
      <span>
        <strong>{hostName ? `${hostName} (host)` : "Host WhatsApp"}</strong>
        <a href={whatsappHref(hostWhatsapp, text)} target="_blank" rel="noreferrer">
          {hostWhatsapp}
        </a>
      </span>
    </div>
  );
}

function JoinedPastCard({
  item,
  hostStats,
  onAnswer,
}: {
  item: RunParticipantActivity;
  hostStats?: UserStats;
  onAnswer: (runAgain: boolean) => void;
}) {
  const answered = item.joinerReviewedAt != null || item.joinerRunAgain != null;
  return (
    <article className={`activity-card${answered ? "" : " activity-card--awaiting"}`}>
      <div className="activity-card-head">
        <span className="status-badge status-badge--past">Completed</span>
      </div>
      <h3>{item.run.title}</h3>
      <RunFactGrid run={item.run} />
      <StatsBadge stats={hostStats} />
      {answered ? (
        <p className="activity-note">
          {item.joinerRunAgain ? "You'd run with them again 👍" : "Saved — no run again."}
        </p>
      ) : (
        <div className="joiner-recap">
          <span>Would you run with the host again?</span>
          <div className="joiner-recap-actions">
            <button type="button" className="recap-pill recap-pill--active" onClick={() => onAnswer(true)}>👍 Yes</button>
            <button type="button" className="recap-pill" onClick={() => onAnswer(false)}>👎 No</button>
          </div>
        </div>
      )}
    </article>
  );
}

function HostedRunCard({
  hosted,
  stats,
  hostName,
  onApprove,
  onDecline,
  onWrapUp,
  onCancel
}: {
  hosted: HostedRunActivity;
  stats?: Record<string, UserStats>;
  hostName?: string;
  onApprove: (request: RunParticipantActivity) => void;
  onDecline: (request: RunParticipantActivity) => void;
  onWrapUp?: (hosted: HostedRunActivity) => void;
  onCancel?: (hosted: HostedRunActivity) => void;
}) {
  const isPast = hosted.run.status === "completed" || hosted.run.status === "expired";
  const startTimeMs = new Date(hosted.run.startTime).getTime();
  const hasStarted = !Number.isNaN(startTimeMs) && Date.now() >= startTimeMs;
  const badge = hosted.run.status === "completed" ? "Completed"
    : hosted.run.status === "expired" ? "Cancelled"
    : "Hosting";
  return (
    <article className={`activity-card hosted-card${isPast ? " hosted-card--past" : ""}`}>
      <div className="activity-card-head">
        <span className="activity-card-badges">
          <span className={`status-badge host${isPast ? " status-badge--past" : ""}`}>{badge}</span>
          {hosted.run.recurrence === "weekly" ? <span className="weekly-pill">WEEKLY</span> : null}
          {hosted.run.womenOnly ? <span className="women-only-pill">WOMEN ONLY</span> : null}
        </span>
        {!isPast && onWrapUp && hasStarted ? (
          <button className="text-btn text-btn--accent" onClick={() => onWrapUp(hosted)}>Wrap up</button>
        ) : !isPast && onCancel && !hasStarted ? (
          <button className="text-btn" onClick={() => onCancel(hosted)}>Cancel run</button>
        ) : null}
      </div>
      <h3>{hosted.run.title}</h3>
      <RunFactGrid run={hosted.run} />
      <div className="host-counts">
        <span>{hosted.confirmedCount} confirmed</span>
        {!isPast ? <span>{hosted.pendingRequests.length} pending</span> : null}
      </div>

      {hosted.confirmedRequests.length ? (
        <div className="approved-contact-list">
          {hosted.confirmedRequests.map((request) => (
            <div key={request.id} className="approved-contact approved-contact--requester">
              <div className="approved-contact-header">
                <strong>{request.requesterName}</strong>
                <StatsBadge stats={stats?.[request.userId]} />
              </div>
              <RequesterSocials
                whatsapp={request.requesterWhatsapp}
                socials={request.requesterSocials}
                run={hosted.run}
                senderName={hostName}
                recipientName={request.requesterName}
              />
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
                <StatsBadge stats={stats?.[request.userId]} />
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

function RecapModal({
  hosted,
  onClose,
  onSave,
}: {
  hosted: HostedRunActivity;
  onClose: () => void;
  onSave: (outcomes: { participantId: string; outcome: HostOutcome; runAgain: boolean }[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, { outcome: HostOutcome; runAgain: boolean }>>(() =>
    Object.fromEntries(hosted.confirmedRequests.map((r) => [r.id, { outcome: "showed_up" as HostOutcome, runAgain: false }]))
  );
  const [busy, setBusy] = useState(false);

  function setOutcome(id: string, outcome: HostOutcome) {
    setDraft((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { outcome, runAgain: false }), outcome } }));
  }
  function toggleRunAgain(id: string) {
    setDraft((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { outcome: "showed_up", runAgain: false }), runAgain: !(prev[id]?.runAgain ?? false) } }));
  }

  async function save() {
    setBusy(true);
    const outcomes = hosted.confirmedRequests.map((r) => ({
      participantId: r.id,
      outcome: draft[r.id]?.outcome ?? ("showed_up" as HostOutcome),
      runAgain: draft[r.id]?.runAgain ?? false,
    }));
    await onSave(outcomes);
    setBusy(false);
  }

  return (
    <div className="recap-backdrop" role="dialog" aria-label="Wrap up run">
      <section className="recap-panel">
        <header>
          <p className="modal-eyebrow">Wrap up</p>
          <h2>{hosted.run.title}</h2>
          <p>How did it go?</p>
        </header>
        {hosted.confirmedRequests.length === 0 ? (
          <p className="recap-empty">No confirmed runners. Tap save to close out the run.</p>
        ) : (
          <div className="recap-list">
            {hosted.confirmedRequests.map((r) => {
              const d = draft[r.id] ?? { outcome: "showed_up" as HostOutcome, runAgain: false };
              return (
                <div className="recap-row" key={r.id}>
                  <strong>{r.requesterName}</strong>
                  <div className="recap-outcomes" role="group">
                    {([
                      { value: "showed_up" as HostOutcome, label: "Showed up" },
                      { value: "no_show" as HostOutcome, label: "No-show" },
                      { value: "skipped" as HostOutcome, label: "Skip" },
                    ]).map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        className={`recap-pill${d.outcome === o.value ? " recap-pill--active" : ""}`}
                        onClick={() => setOutcome(r.id, o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <label className="recap-toggle">
                    <input type="checkbox" checked={d.runAgain} onChange={() => toggleRunAgain(r.id)} />
                    <span>Run again with {r.requesterName.split(" ")[0]}</span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
        <div className="recap-actions">
          <button className="secondary-cta" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary-cta" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save & close"}</button>
        </div>
      </section>
    </div>
  );
}

function RequesterSocials({
  whatsapp,
  socials,
  run,
  senderName,
  recipientName,
}: {
  whatsapp?: string;
  socials?: string;
  run?: CoreRun;
  senderName?: string;
  recipientName?: string;
}) {
  if (!whatsapp && !socials) return null;
  const platform = socials ? detectSocialsPlatform(socials) : null;
  const platformLabel: Record<string, string> = {
    strava: "Strava",
    instagram: "Instagram",
    garmin: "Garmin",
  };
  const socialHref = socials ? (socials.startsWith("http") ? socials : `https://${socials}`) : "";
  const waText = whatsapp && run ? buildRunWhatsappMessage({ run, senderName, recipientName }) : undefined;
  return (
    <div className="requester-socials">
      {whatsapp ? (
        <a className="requester-social" href={whatsappHref(whatsapp, waText)} target="_blank" rel="noreferrer">
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
          {/* Strava/Garmin share IDs are opaque gibberish — show just the label.
              Instagram handles are human-readable, so keep them. */}
          {platform === "strava" || platform === "garmin" ? null : socialHandle(socials)}
        </a>
      ) : null}
    </div>
  );
}

function socialHandle(url: string) {
  // Drop scheme, trailing slash, and any query/hash so we don't render
  // tracking params like "?igsh=..." in the chip.
  const cleaned = url
    .replace(/^https?:\/\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "");
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
  onRuns,
  onPosted,
  onProfile,
  runsBadge = 0
}: {
  city: CitySlug;
  profile: OnboardingDraft;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
  onBack: () => void;
  onMap: () => void;
  onRuns: () => void;
  onPosted: () => void;
  onProfile: () => void;
  runsBadge?: number;
}) {
  const [draft, setDraft] = useState<PostRunDraft>(() => ({
    startTime: defaultStartTime(),
    paceSeconds: profile.comfortable_pace_seconds_per_km,
    distanceKm: 7,
    intent: "social",
    locationName: "",
    pickedLat: null,
    pickedLng: null,
    recurring: false,
    womenOnly: false,
    note: "",
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locationNameTouched, setLocationNameTouched] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  // Reset pin when city changes — bounds differ.
  useEffect(() => {
    setDraft((current) => ({ ...current, pickedLat: null, pickedLng: null, locationName: "" }));
    setLocationNameTouched(false);
    setSuggestions([]);
    setSuggestionsOpen(false);
  }, [city]);

  // Debounced forward-geocode as the user types the location name.
  useEffect(() => {
    if (!suggestionsOpen) return;
    const query = draft.locationName.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      forwardGeocode(query, city).then((results) => {
        setSuggestions(results);
        setSearching(false);
      });
    }, 400);
    return () => {
      clearTimeout(handle);
      setSearching(false);
    };
  }, [draft.locationName, city, suggestionsOpen]);

  function handlePickLocation(lat: number, lng: number) {
    setDraft((current) => ({ ...current, pickedLat: lat, pickedLng: lng }));
    setError("");
    setSuggestionsOpen(false);
    setSuggestions([]);
    if (locationNameTouched) return;
    reverseGeocode(lat, lng).then((name) => {
      if (!name) return;
      setDraft((current) => (current.pickedLat === lat && current.pickedLng === lng && !locationNameTouched
        ? { ...current, locationName: name }
        : current));
    });
  }

  function chooseSuggestion(suggestion: LocationSuggestion) {
    setDraft((current) => ({
      ...current,
      locationName: suggestion.label.split(" — ")[0],
      pickedLat: suggestion.lat,
      pickedLng: suggestion.lng,
    }));
    setLocationNameTouched(true);
    setSuggestionsOpen(false);
    setSuggestions([]);
    setError("");
  }

  async function submitRun() {
    const { paceSeconds, distanceKm } = draft;

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
        description: draft.note.trim() || null,
        locationName: draft.locationName.trim(),
        lat: draft.pickedLat,
        lng: draft.pickedLng,
        startTime: draft.startTime,
        paceSeconds,
        distanceKm,
        intent: draft.intent,
        maxGroupSize: 3,
        recurrence: draft.recurring ? "weekly" : null,
        womenOnly: draft.womenOnly,
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
      <BrandBar
        page="post"
        onLogo={onMap}
        onMap={onMap}
        onRuns={onRuns}
        onProfile={onProfile}
        runsBadge={runsBadge}
      />
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
            <input
              value={draft.startTime}
              type="datetime-local"
              onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))}
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
            />
          </label>
          <div className="field-label">
            <span className="field-label-row">
              <span>Pace</span>
              <strong className="field-label-value">{formatPace(draft.paceSeconds)}/km</strong>
            </span>
            <input
              aria-label="Pace in minutes per kilometre"
              type="range"
              className="slider-range"
              min={180}
              max={480}
              step={5}
              value={draft.paceSeconds}
              onChange={(event) => setDraft((current) => ({ ...current, paceSeconds: Number(event.target.value) }))}
            />
            <div className="slider-labels">
              <span>3:00</span>
              <span>8:00</span>
            </div>
          </div>
          <div className="field-label">
            <span className="field-label-row">
              <span>Distance</span>
              <strong className="field-label-value">{draft.distanceKm} km</strong>
            </span>
            <input
              aria-label="Distance in kilometres"
              type="range"
              className="slider-range"
              min={1}
              max={42}
              step={1}
              value={draft.distanceKm}
              onChange={(event) => setDraft((current) => ({ ...current, distanceKm: Number(event.target.value) }))}
            />
            <div className="slider-labels">
              <span>1 km</span>
              <span>42 km</span>
            </div>
          </div>
          <label className="field-label">
            <span className="field-label-row">
              <span>Note (optional)</span>
              <span className="field-label-count">{draft.note.length}/{RUN_NOTE_MAX}</span>
            </span>
            <textarea
              className="run-note-input"
              value={draft.note}
              maxLength={RUN_NOTE_MAX}
              rows={2}
              placeholder="e.g. Easy chatty pace, coffee after. New runners welcome."
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })}
            />
          </label>
          <label className={`recurrence-toggle${draft.recurring ? " recurrence-toggle--on" : ""}`}>
            <input
              type="checkbox"
              checked={draft.recurring}
              onChange={(event) => setDraft((current) => ({ ...current, recurring: event.target.checked }))}
            />
            <span className="recurrence-toggle-copy">
              <strong>Repeat weekly</strong>
              <small>Posts the same time and place every week. People can rejoin each round.</small>
            </span>
            <span className="recurrence-toggle-switch" aria-hidden="true" />
          </label>
          <label className={`recurrence-toggle${draft.womenOnly ? " recurrence-toggle--on recurrence-toggle--safety" : ""}`}>
            <input
              type="checkbox"
              checked={draft.womenOnly}
              onChange={(event) => setDraft((current) => ({ ...current, womenOnly: event.target.checked }))}
            />
            <span className="recurrence-toggle-copy">
              <strong>Women-only run</strong>
              <small>Flag this run as women-only. Visible to everyone for transparency.</small>
            </span>
            <span className="recurrence-toggle-switch" aria-hidden="true" />
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
            <div className="location-search">
              <input
                value={draft.locationName}
                onChange={(event) => {
                  setLocationNameTouched(true);
                  setSuggestionsOpen(true);
                  setDraft((current) => ({ ...current, locationName: event.target.value }));
                }}
                onFocus={() => {
                  if (draft.locationName.trim().length >= 2) setSuggestionsOpen(true);
                }}
                onBlur={() => {
                  // Delay so a click on a suggestion still registers.
                  setTimeout(() => setSuggestionsOpen(false), 150);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && suggestions.length > 0) {
                    event.preventDefault();
                    chooseSuggestion(suggestions[0]);
                  }
                }}
                placeholder={city === "sg" ? "Type a place, address, or block (e.g. 88)" : "Type a place or address"}
                autoComplete="off"
              />
              {suggestionsOpen && (searching || suggestions.length > 0) ? (
                <ul className="location-suggestions" role="listbox">
                  {searching && suggestions.length === 0 ? (
                    <li className="location-suggestion-empty">Searching…</li>
                  ) : (
                    suggestions.map((suggestion, index) => (
                      <li key={`${suggestion.lat}-${suggestion.lng}-${index}`}>
                        <button
                          type="button"
                          className="location-suggestion"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseSuggestion(suggestion)}
                        >
                          {suggestion.label}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
            <small className="picker-hint">
              Type to search{city === "sg" ? " (block numbers work too)" : ""}, or tap the map to drop a pin.
            </small>
          </div>
        </div>

        {error ? <p className="auth-notice">{error}</p> : null}

        <button className="primary-cta sticky-cta" onClick={submitRun} disabled={busy}>
          {busy ? "Posting..." : "Post run"}
        </button>
      </section>
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
  onPostRun,
  onShowRuns,
  onProfile,
  onCityChange,
  runsBadge = 0
}: {
  city: CitySlug;
  profile: OnboardingDraft;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
  requestedRunId: string;
  onRequest: (runId: string) => void;
  onPostRun: () => void;
  onShowRuns: () => void;
  onProfile: () => void;
  onCityChange: (slug: CitySlug) => void;
  runsBadge?: number;
}) {
  const cityConf = CITY_CONFIG[city];
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
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
  const runListRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ active: false, moved: false, startY: 0, startSheetY: 0, currentY: 0 });
  const leafletRef = useRef<{
    map: import("leaflet").Map;
    youMarker: import("leaflet").Marker;
    markers: import("leaflet").Marker[];
  } | null>(null);
  const filteredRuns = useMemo(() => {
    const loc = locationStatus === "found" ? userLocation : null;
    const ctx = { userLocation: loc };
    let list = runs.filter((run) => runMatchesMapFilter(run, activeFilter, profile, ctx));
    // When we know where the user is, attach straight-line distance and sort
    // nearest-first. Distance is a sort, never a hard cut — so the closest run
    // always surfaces even if nothing sits within 2 km.
    if (loc) {
      list = list
        .map((run) => ({
          ...run,
          proximityKm: haversineMeters(loc[0], loc[1], run.lat, run.lng) / 1000,
        }))
        .sort((a, b) => (a.proximityKm ?? Infinity) - (b.proximityKm ?? Infinity));
    }
    return list;
  }, [activeFilter, runs, profile, locationStatus, userLocation]);

  useEffect(() => {
    setUserLocation(cityConf.youLL);
    setLocationStatus("idle");
    leafletRef.current?.map.setView(cityConf.center, cityConf.zoom);
  }, [cityConf.center, cityConf.youLL, cityConf.zoom, city]);

  useEffect(() => {
    let cancelled = false;
    setRunsStatus("loading");
    // Always fetch the full city list. The "Near me" 2 km filter is applied
    // client-side so flipping back to "All" doesn't require a refetch.
    fetchOpenRuns(supabase, { city })
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
  }, [supabase, city, refreshKey]);

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
    // Open the sheet to PEEK (half) so the map stays visible — never full —
    // then scroll only the run-list so the selected card sits at the top.
    // Manual scrollTop (not scrollIntoView) avoids bubbling up and resizing
    // the sheet to full.
    setSheetState("peek");
    setDragY(null);
    requestAnimationFrame(() => {
      const list = runListRef.current;
      const card = list?.querySelector<HTMLElement>(`[data-run-id="${run.id}"]`);
      if (list && card) {
        const delta = card.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTo({ top: list.scrollTop + delta, behavior: "smooth" });
      }
    });
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
        setActiveFilter("near_me");
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
      <BrandBar
        page="map"
        onLogo={() => {
          // On map already — recentre on the city and snap the sheet
          // back to peek so the user can see the map again.
          leafletRef.current?.map.flyTo(cityConf.center, cityConf.zoom, { duration: 0.6 });
          setSheetState("peek");
        }}
        onLocate={findMyLocation}
        locationStatus={locationStatus}
        onPostRun={onPostRun}
        onRuns={onShowRuns}
        onProfile={onProfile}
        runsBadge={runsBadge}
      />

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
          <h1>
            {filteredRuns.length} runs near
            <br />
            <span>your pace</span>
          </h1>
          <button
            type="button"
            className="city-switch"
            aria-label={`Change city — currently ${CITY_CONFIG[city].label}`}
            onClick={(event) => {
              event.stopPropagation();
              setCityPickerOpen(true);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <MapPin size={13} />
            <span className="city-switch-city">{CITY_CONFIG[city].label}</span>
            <ChevronDown size={14} />
          </button>
        </header>

        <div className="filter-strip" aria-label="Run filters">
          {mapRunFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`fpill ${activeFilter === filter.value ? "active" : ""}`}
              aria-pressed={activeFilter === filter.value}
              onClick={() => {
                setActiveFilter(filter.value);
                if (filter.value === "near_me" && locationStatus !== "found" && locationStatus !== "locating") {
                  findMyLocation();
                }
              }}
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
          <div className="run-list matched-run-list" ref={runListRef}>
            {filteredRuns.map((run, index) => {
              // Soft "Further out" divider: the first run beyond 2 km, only
              // when we have the user's location to measure against.
              const showDivider =
                typeof run.proximityKm === "number" &&
                run.proximityKm * 1000 > NEAR_ME_RADIUS_M &&
                (index === 0 ||
                  (filteredRuns[index - 1].proximityKm ?? 0) * 1000 <= NEAR_ME_RADIUS_M);
              return (
                <Fragment key={run.id}>
                  {showDivider ? (
                    <div className="run-list-divider" role="separator">Further out</div>
                  ) : null}
                  <MatchedRunCard
                    run={run}
                    active={run.id === activeRunId}
                    requested={run.id === requestedRunId}
                    isHost={!!profileId && run.organiserId === profileId}
                    onSelect={() => selectRun(run)}
                    onRequest={() => requestSpot(run)}
                  />
                </Fragment>
              );
            })}
          </div>
        ) : runs.length ? (
          activeFilter === "my_pace" ? (
            <div className="run-list-empty">
              <p>
                No runs in your pace range ({formatPace(normalizePaceRange(profile).min)}–
                {formatPace(normalizePaceRange(profile).max)}/km) right now.
              </p>
              <p className="run-list-empty-sub">
                That range is approximate — tweak it anytime in your profile.
              </p>
              <button className="text-btn" onClick={onProfile}>Update your pace</button>
            </div>
          ) : activeFilter === "near_me" ? (
            <div className="run-list-empty">
              <p>No open runs in {CITY_CONFIG[city].label} yet.</p>
              <button className="text-btn" onClick={() => setActiveFilter("all")}>See all runs</button>
            </div>
          ) : (
            <div className="run-list-empty">No runs match this filter yet.</div>
          )
        ) : (
          <div className="run-list-empty">No runs nearby yet. Post the first one.</div>
        )}
      </section>

      {cityPickerOpen ? (
        <div className="city-picker-overlay" onClick={() => setCityPickerOpen(false)}>
          <div className="city-picker" onClick={(event) => event.stopPropagation()}>
            <p className="city-picker-title">Choose your city</p>
            <p className="city-picker-group">Live now</p>
            {CITY_PICKER.filter((c) => c.live).map((c) => (
              <button
                key={c.label}
                type="button"
                className={`city-picker-item${c.slug === city ? " city-picker-item--active" : ""}`}
                onClick={() => {
                  if (c.slug) onCityChange(c.slug);
                  setCityPickerOpen(false);
                }}
              >
                {c.label}
                {c.slug === city ? <Check size={16} /> : null}
              </button>
            ))}
            <p className="city-picker-group">Coming soon</p>
            {CITY_PICKER.filter((c) => !c.live).map((c) => (
              <div key={c.label} className="city-picker-item city-picker-item--soon">
                {c.label}
                <span className="city-picker-soon-tag">Soon</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </main>
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
    <article className={`run-card matched-map-card ${active ? "active" : ""} ${requested ? "requested" : ""}`} data-run-id={run.id}>
      <button className="matched-card-main" onClick={onSelect}>
        <span className="match-topline">
          <span>
            {level}
            {run.recurrence === "weekly" ? <span className="weekly-pill">WEEKLY</span> : null}
            {run.womenOnly ? <span className="women-only-pill">WOMEN ONLY</span> : null}
            {typeof run.proximityKm === "number" ? (
              <span className="distance-pill">{proximityLabel(run.proximityKm)}</span>
            ) : null}
          </span>
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
        {run.description ? <span className="run-card-note">{run.description}</span> : null}
        <span className="run-card-foot">
          <span>{level.toLowerCase()}</span>
          <span className="view-pill">{run.locationName}</span>
        </span>
      </button>
      {active && !isHost ? <HostMiniProfile run={run} /> : null}
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

const runnerTypeLabels: Record<string, string> = Object.fromEntries(
  runnerTypes.map((r) => [r.value, r.label])
);
const profileIntentLabels: Record<string, string> = Object.fromEntries(
  intents.map((i) => [i.value, i.label])
);

function HostMiniProfile({ run }: { run: RunRow }) {
  const name = run.organiserName?.trim();
  const runnerType = run.organiserRunnerType ? runnerTypeLabels[run.organiserRunnerType] : null;
  const intentLabelList = (run.organiserRunIntents ?? [])
    .map((value) => profileIntentLabels[value])
    .filter(Boolean);
  const completed = run.organiserCompletedRuns ?? 0;
  const runsLabel = completed === 1 ? "1 matched run" : `${completed} matched runs`;
  const hasSocials = Boolean(run.organiserSocials);

  if (!name && !runnerType && !intentLabelList.length && !hasSocials && !completed) return null;

  return (
    <div className="host-mini">
      <div className="host-mini-head">
        <span className="host-mini-name">{name ? `Hosted by ${name}` : "Host"}</span>
        <span className="host-mini-runs">{runsLabel}</span>
      </div>
      {runnerType || intentLabelList.length ? (
        <div className="host-mini-tags">
          {runnerType ? <span className="host-mini-tag">{runnerType}</span> : null}
          {intentLabelList.map((label) => (
            <span key={label} className="host-mini-tag host-mini-tag--soft">{label}</span>
          ))}
        </div>
      ) : null}
      {/* Socials only — WhatsApp stays private until the host approves. */}
      {hasSocials ? <RequesterSocials socials={run.organiserSocials ?? undefined} /> : null}
    </div>
  );
}

function runMatchesMapFilter(
  run: RunRow,
  filter: MapRunFilter,
  profile: OnboardingDraft,
  context: { userLocation: [number, number] | null }
) {
  if (filter === "all") return true;
  // "Near me" is a proximity *sort* (applied in filteredRuns), not a hard
  // radius cut — so the closest runs surface even when none are within 2 km.
  if (filter === "near_me") return true;
  if (filter === "my_pace") {
    const center = profile.comfortable_pace_seconds_per_km ?? 315;
    const min = profile.comfortable_pace_min_seconds_per_km ?? center - 15;
    const max = profile.comfortable_pace_max_seconds_per_km ?? center + 15;
    return run.paceSeconds >= min && run.paceSeconds <= max;
  }
  if (filter === "today") {
    const start = new Date(run.startTime);
    const now = new Date();
    return start.getFullYear() === now.getFullYear()
      && start.getMonth() === now.getMonth()
      && start.getDate() === now.getDate();
  }
  if (filter === "has_space") return run.currentSpots < run.maxGroupSize;
  if (filter === "social") return run.intent === "social";
  if (filter === "tempo") return run.intent === "tempo";
  return true;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Human-friendly "X away" label for a run's straight-line distance in km.
function proximityLabel(km: number) {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
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

function BrandBar({
  page = "other",
  onMap,
  onPostRun,
  onRuns,
  onProfile,
  onLocate,
  onLogo,
  locationStatus,
  runsBadge = 0,
}: {
  page?: "map" | "runs" | "post" | "profile" | "other";
  onMap?: () => void;
  onPostRun?: () => void;
  onRuns?: () => void;
  onProfile?: () => void;
  onLocate?: () => void;
  onLogo?: () => void;
  locationStatus?: LocationStatus;
  runsBadge?: number;
}) {
  const logoHandler = onLogo ?? onMap;
  const LogoContent = (
    <>
      <LogoMark />
      runi<span>o</span>n
    </>
  );
  return (
    <div className="topbar">
      {logoHandler ? (
        <button
          type="button"
          className="logo logo-btn"
          aria-label="Go to map"
          onClick={logoHandler}
        >
          {LogoContent}
        </button>
      ) : (
        <div className="logo" aria-label="runion">
          {LogoContent}
        </div>
      )}
      <div className="topbar-actions">
        {page === "map" && onLocate ? (
          <button
            className={`icon-btn ${locationStatus === "locating" ? "loading" : ""} ${locationStatus === "found" ? "found" : ""}`}
            aria-label="Find my location"
            onClick={onLocate}
            disabled={locationStatus === "locating"}
            type="button"
          >
            <LocateFixed size={17} />
          </button>
        ) : null}
        {page !== "map" && onMap ? (
          <button className="icon-btn" aria-label="Open map" onClick={onMap} type="button">
            <MapPin size={17} />
          </button>
        ) : null}
        {page !== "post" && onPostRun ? (
          <button className="icon-btn" aria-label="Post a run" onClick={onPostRun} type="button">
            <Plus size={17} />
          </button>
        ) : null}
        {page !== "runs" && onRuns ? (
          <button
            className="icon-btn"
            aria-label={runsBadge > 0 ? `My runs, ${runsBadge} new` : "My runs"}
            onClick={onRuns}
            type="button"
          >
            <Footprints size={17} />
            {runsBadge > 0 ? (
              <span className="icon-badge" aria-hidden="true">{runsBadge > 9 ? "9+" : runsBadge}</span>
            ) : null}
          </button>
        ) : null}
        {page !== "profile" && onProfile ? (
          <button className="icon-btn profile-icon-btn" aria-label="Open profile" onClick={onProfile} type="button">
            <UserRound size={17} />
          </button>
        ) : null}
      </div>
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


function hasRunActivity(activity: { pending: RunParticipantActivity[]; confirmed: RunParticipantActivity[]; pastConfirmed: RunParticipantActivity[]; hosted: HostedRunActivity[]; pastHosted: HostedRunActivity[] }) {
  return activity.pending.length > 0 || activity.confirmed.length > 0 || activity.pastConfirmed.length > 0 || activity.hosted.length > 0 || activity.pastHosted.length > 0;
}

function titleFromIntent(intent: CoreIntent) {
  if (intent === "tempo") return "Tempo run";
  return "Social run";
}

function normalizeIntent(value?: string): CoreIntent {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("tempo") || lower.includes("performance") || lower.includes("speed") || lower.includes("event") || lower.includes("hill")) return "tempo";
  // Legacy "consistency" runs collapse into social so historical rows stay renderable.
  return "social";
}

function normalizeParticipantStatus(value?: string): ParticipantStatus | null {
  if (value === "requested" || value === "confirmed" || value === "declined") return value;
  if (value === "pending") return "requested";
  return null;
}

function profileIntentToCoreIntent(intent: RunIntent): CoreIntent {
  if (intent === "improve_speed" || intent === "train_event") return "tempo";
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

function collectStatIds(raw: import("@/lib/api/runs").MyActivity, selfId: string): string[] {
  const ids = new Set<string>();
  for (const { run } of [...raw.confirmed, ...raw.pastConfirmed]) {
    if (run.organiserId && run.organiserId !== selfId) ids.add(run.organiserId);
  }
  for (const { participant } of raw.pending) {
    if (participant.userId !== selfId) ids.add(participant.userId);
  }
  for (const bucket of [...raw.hosted, ...raw.pastHosted]) {
    for (const p of [...bucket.pending, ...bucket.confirmed]) {
      if (p.userId !== selfId) ids.add(p.userId);
    }
  }
  return Array.from(ids);
}

function StatsBadge({ stats }: { stats?: UserStats }) {
  if (!stats || (stats.completedRuns === 0 && stats.mutualAffinity === 0)) return null;
  const runs = stats.completedRuns === 1 ? "1 run" : `${stats.completedRuns} runs`;
  const mut = stats.mutualAffinity === 1 ? "1 mutual" : `${stats.mutualAffinity} mutuals`;
  return <span className="stats-badge">{runs} · {mut}</span>;
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
    organiserId: run.organiserId ?? undefined,
    organiserName: run.organiserName ?? undefined,
    organiserSocials: run.organiserSocials ?? undefined,
    organiserRunnerType: run.organiserRunnerType ?? undefined,
    organiserRunIntents: run.organiserRunIntents ?? undefined,
    organiserCompletedRuns: run.organiserCompletedRuns ?? undefined,
    recurrence: run.recurrence ?? null,
    womenOnly: run.womenOnly ?? false,
    source: "db",
  };
}

function participantRowToActivity(
  p: ParticipantRow,
  run: CoreRun,
  fallbackProfile: OnboardingDraft,
  host?: { name?: string | null; whatsapp?: string | null }
): RunParticipantActivity {
  return {
    id: p.id,
    userId: p.userId,
    run,
    status: p.status as ParticipantStatus,
    requesterName: p.requesterName ?? fallbackProfile.name ?? "Runner",
    requesterWhatsapp: p.requesterWhatsapp ?? undefined,
    requesterSocials: p.requesterSocials ?? undefined,
    requesterPace: fallbackProfile.comfortable_pace_seconds_per_km,
    requesterIntent: profileIntentToCoreIntent(fallbackProfile.run_intents[0] ?? "find_partners"),
    joinerRunAgain: p.joinerRunAgain,
    joinerReviewedAt: p.joinerReviewedAt,
    hostOrganiserId: run.organiserId,
    hostName: host?.name ?? undefined,
    hostWhatsapp: host?.whatsapp ?? undefined,
    createdAt: p.createdAt,
  };
}

function adaptMyActivity(
  raw: import("@/lib/api/runs").MyActivity,
  profile: OnboardingDraft
): { pending: RunParticipantActivity[]; confirmed: RunParticipantActivity[]; pastConfirmed: RunParticipantActivity[]; hosted: HostedRunActivity[]; pastHosted: HostedRunActivity[] } {
  const pending = raw.pending.map(({ participant, run }) =>
    participantRowToActivity(participant, runRowToCoreRun(run), profile, { name: run.organiserName, whatsapp: run.organiserWhatsapp })
  );
  const confirmed = raw.confirmed.map(({ participant, run }) =>
    participantRowToActivity(participant, runRowToCoreRun(run), profile, { name: run.organiserName, whatsapp: run.organiserWhatsapp })
  );
  const pastConfirmed = raw.pastConfirmed.map(({ participant, run }) =>
    participantRowToActivity(participant, runRowToCoreRun(run), profile, { name: run.organiserName, whatsapp: run.organiserWhatsapp })
  );
  const adaptHosted = ({ run, pending: pendingRows, confirmed: confirmedRows }: import("@/lib/api/runs").HostedBucket): HostedRunActivity => {
    const core = runRowToCoreRun(run);
    return {
      run: core,
      confirmedCount: confirmedRows.length,
      confirmedRequests: confirmedRows.map((p) => participantRowToActivity(p, core, profile)),
      pendingRequests: pendingRows.map((p) => participantRowToActivity(p, core, profile)),
    };
  };
  const hosted = raw.hosted.map(adaptHosted);
  const pastHosted = raw.pastHosted.map(adaptHosted);
  return { pending, confirmed, pastConfirmed, hosted, pastHosted };
}

function AvatarPicker({
  photoUrl,
  profileId,
  supabase,
  onChange,
  fallbackInitials,
}: {
  photoUrl?: string;
  profileId?: string;
  supabase: ReturnType<typeof createClient>;
  onChange: (url: string) => void;
  fallbackInitials?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!profileId || profileId === "preview-user" || !supabase) {
      setError("Sign in to upload a photo.");
      return;
    }
    setBusy(true);
    try {
      const { url } = await uploadAvatar(supabase, profileId, file);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="avatar-picker">
      <button
        type="button"
        className={`avatar-picker-button${photoUrl ? " avatar-picker-button--filled" : ""}`}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="photo-avatar" src={photoUrl} alt="" referrerPolicy="no-referrer" />
        ) : fallbackInitials ? (
          <span className="avatar-initials">{fallbackInitials}</span>
        ) : (
          <Camera size={22} />
        )}
        <span className="avatar-picker-cta">
          {busy ? "Uploading…" : photoUrl ? "Change photo" : "Add a photo"}
        </span>
      </button>
      {error ? <span className="avatar-picker-error">{error}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        style={{ display: "none" }}
        onChange={(event) => handleFile(event.target.files?.[0] ?? undefined)}
      />
    </div>
  );
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

const CITY_COUNTRY: Record<CitySlug, string> = { sg: "sg", bcn: "es", par: "fr", ber: "de" };

type LocationSuggestion = { label: string; lat: number; lng: number };

// Singapore's official geocoder. Keyless search endpoint; resolves postal
// codes, block numbers, and building names to lat/lng + a clean address.
async function oneMapSearch(query: string): Promise<LocationSuggestion[]> {
  const params = new URLSearchParams({
    searchVal: query,
    returnGeom: "Y",
    getAddrDetails: "Y",
    pageNum: "1",
  });
  try {
    const response = await fetch(
      `https://www.onemap.gov.sg/api/common/elastic/search?${params.toString()}`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      results?: Array<{
        SEARCHVAL?: string;
        BLK_NO?: string;
        ROAD_NAME?: string;
        BUILDING?: string;
        ADDRESS?: string;
        POSTAL?: string;
        LATITUDE?: string;
        LONGITUDE?: string;
      }>;
    };
    return (data.results ?? [])
      .map((row) => {
        const lat = Number(row.LATITUDE);
        const lng = Number(row.LONGITUDE);
        const building = row.BUILDING && row.BUILDING !== "NIL" ? row.BUILDING : "";
        const street = [row.BLK_NO, row.ROAD_NAME].filter(Boolean).join(" ").trim();
        const primary = building || street || row.SEARCHVAL || "Singapore";
        const context = [building ? street : "", row.POSTAL ? `S${row.POSTAL}` : ""]
          .filter(Boolean)
          .join(", ");
        const label = context ? `${primary} — ${context}` : primary;
        return { label, lat, lng };
      })
      .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function forwardGeocode(query: string, city: CitySlug): Promise<LocationSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  // Singapore: OneMap is the authoritative geocoder. It resolves 6-digit
  // postal codes (079718 -> 8 ENGGOR STREET), block numbers, and building
  // names far better than Nominatim. Fall back to Nominatim only if it
  // returns nothing.
  if (city === "sg") {
    const oneMap = await oneMapSearch(trimmed);
    if (oneMap.length) return oneMap;
  }

  const bounds = CITY_BOUNDS[city];
  // Non-OneMap fallback: bare digits/short alphanumerics usually refer to an
  // HDB block; prefix "Block" so Nominatim resolves "88" or "123A".
  const isSgBlock = city === "sg" && /^\d+[a-zA-Z]?$/.test(trimmed);
  const q = isSgBlock ? `Block ${trimmed} Singapore` : trimmed;
  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "5",
    addressdetails: "1",
    countrycodes: CITY_COUNTRY[city],
    viewbox: `${bounds.west},${bounds.north},${bounds.east},${bounds.south}`,
    bounded: "1",
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      name?: string;
      address?: Record<string, string>;
    }>;
    return data
      .map((row) => {
        const addr = row.address ?? {};
        const primary =
          row.name ||
          addr.attraction ||
          addr.park ||
          addr.leisure ||
          addr.tourism ||
          addr.road ||
          addr.suburb ||
          addr.neighbourhood ||
          row.display_name.split(",")[0];
        const context = row.display_name
          .split(",")
          .slice(1, 3)
          .map((part) => part.trim())
          .filter(Boolean)
          .join(", ");
        const cleanedPrimary = primary?.trim() || row.display_name;
        const label = context ? `${cleanedPrimary} — ${context}` : cleanedPrimary;
        const lat = Number(row.lat);
        const lng = Number(row.lon);
        return { label, lat, lng };
      })
      .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
  } catch {
    return [];
  }
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

// Like toggleValue but refuses to add past `max` (still always allows
// removing). Used to cap intents so the matching signal stays focused.
function toggleValueMax<T>(values: T[], value: T, max: number) {
  if (values.includes(value)) {
    const next = values.filter((item) => item !== value);
    return next.length ? next : values;
  }
  if (values.length >= max) return values;
  return [...values, value];
}

function formatPace(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function clampPace(seconds: number) {
  return Math.min(480, Math.max(180, seconds));
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

function whatsappHref(value: string, text?: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "#";
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}

function buildRunWhatsappMessage({
  run,
  senderName,
  recipientName,
}: {
  run: CoreRun;
  senderName?: string;
  recipientName?: string;
}) {
  const recipientFirst = recipientName?.split(" ")[0];
  const senderFirst = senderName?.split(" ")[0];
  const greeting = recipientFirst ? `Hi ${recipientFirst},` : "Hi,";
  const intro = senderFirst
    ? `${greeting} it's ${senderFirst} from runion.`
    : `${greeting} reaching out via runion.`;
  const signOff = senderFirst ? ` - ${senderFirst}` : "";
  const lines = [
    intro,
    "",
    `Confirming our ${run.title || "run"}:`,
    `Where: ${run.locationName}`,
    `When: ${runDayLabel(run.startTime)} ${runTimeLabel(run.startTime)}`,
    `Run: ${run.distanceKm} km, ${runPaceLabel(run)}/km`,
    "",
    `See you there!${signOff}`,
  ];
  return lines.join("\n");
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
    <svg className="logo-icon" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeWidth="10" />
      <circle cx="126" cy="55" r="15" fill="currentColor" />
      <circle cx="74" cy="55" r="15" fill="currentColor" />
    </svg>
  );
}

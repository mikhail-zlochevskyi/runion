export type CitySlug = "sg" | "bcn" | "par" | "ber";

export type RunStatus = "draft" | "active" | "full" | "completed" | "expired";

export type MatchStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export type Run = {
  id: string;
  city: CitySlug;
  organiserId?: string;
  locationName: string;
  route: string;
  lat: number;
  lng: number;
  day: string;
  runDate: string;
  time: string;
  paceMin: string;
  paceMax: string;
  distanceKm: number;
  goal: string;
  spotsTotal: number;
  spotsTaken: number;
  womenOnly: boolean;
  status: RunStatus;
  clubName?: string;
  organiser: {
    name: string;
    avatarInitial: string;
    runs: number;
    rating: number;
    verified: boolean;
  };
};

export type RunFormInput = {
  name: string;
  city: CitySlug;
  email: string;
  whatsapp?: string;
  stravaUrl?: string;
  garminUrl?: string;
  locationName: string;
  lat: number;
  lng: number;
  day: string;
  runDate: string;
  time: string;
  paceMin: string;
  paceMax: string;
  distanceKm: number;
  goal: string;
  spotsTotal: number;
  womenOnly: boolean;
  clubName?: string;
};

export type RunnerType = "performance_focused" | "explorer" | "social_connector";

export type RunIntent =
  | "build_routine"
  | "find_partners"
  | "train_event"
  | "improve_speed"
  | "increase_distance"
  | "recover_gently"
  | "discover_routes"
  | "stay_accountable";

export type RunAvailability = "morning" | "evening" | "weekends";

export type PreferredGroupSize = "one_to_one" | "two_to_three" | "four_plus";

export type RunnerProfile = {
  id?: string;
  email?: string;
  name: string;
  runner_type: RunnerType;
  comfortable_pace_seconds_per_km: number;
  comfortable_pace_min_seconds_per_km?: number;
  comfortable_pace_max_seconds_per_km?: number;
  run_intents: RunIntent[];
  availability: RunAvailability[];
  preferred_group_size: PreferredGroupSize;
  whatsapp?: string;
  socials_url?: string;
  profile_photo_url?: string;
  onboarding_completed: boolean;
};

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

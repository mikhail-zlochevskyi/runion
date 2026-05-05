import type { CitySlug } from "@/lib/types";

export const CITY_CONFIG: Record<
  CitySlug,
  { label: string; center: [number, number]; zoom: number; youLL: [number, number] }
> = {
  sg: { label: "Singapore", center: [1.326, 103.872], zoom: 12, youLL: [1.2766, 103.8462] },
  bcn: { label: "Barcelona", center: [41.3874, 2.1686], zoom: 13, youLL: [41.3789, 2.1899] },
  par: { label: "Paris", center: [48.8566, 2.3522], zoom: 13, youLL: [48.8584, 2.2945] },
  ber: { label: "Berlin", center: [52.52, 13.405], zoom: 12, youLL: [52.5145, 13.35] }
};

export const DEFAULT_CITY = (process.env.NEXT_PUBLIC_DEFAULT_CITY || "bcn") as CitySlug;

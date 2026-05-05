import type { CitySlug, Run } from "@/lib/types";

export const seedRuns: Run[] = [
  {
    id: "bcn-1",
    city: "bcn",
    locationName: "Barceloneta boardwalk",
    route: "Barceloneta -> Port Olimpic",
    lat: 41.3789,
    lng: 2.1899,
    day: "SAT",
    runDate: "2026-05-09",
    time: "07:00",
    paceMin: "5:00",
    paceMax: "5:30",
    distanceKm: 6,
    goal: "Easy",
    spotsTotal: 2,
    spotsTaken: 0,
    womenOnly: false,
    status: "active",
    clubName: "solo run",
    organiser: { name: "Marc", avatarInitial: "M", runs: 24, rating: 4.8, verified: true }
  },
  {
    id: "bcn-2",
    city: "bcn",
    locationName: "Ciutadella Park loop",
    route: "Arc de Triomf -> Parc Zoologic",
    lat: 41.3863,
    lng: 2.1862,
    day: "SUN",
    runDate: "2026-05-10",
    time: "08:00",
    paceMin: "5:30",
    paceMax: "6:00",
    distanceKm: 5,
    goal: "Social",
    spotsTotal: 1,
    spotsTaken: 0,
    womenOnly: true,
    status: "active",
    clubName: "solo run",
    organiser: { name: "Clara", avatarInitial: "C", runs: 12, rating: 4.9, verified: true }
  },
  {
    id: "bcn-3",
    city: "bcn",
    locationName: "Montjuic hill loop",
    route: "Placa Espanya -> Castell de Montjuic",
    lat: 41.3643,
    lng: 2.1531,
    day: "WED",
    runDate: "2026-05-06",
    time: "06:30",
    paceMin: "5:30",
    paceMax: "6:00",
    distanceKm: 8,
    goal: "Hills",
    spotsTotal: 1,
    spotsTaken: 0,
    womenOnly: false,
    status: "active",
    clubName: "Barcelona Trail Runners",
    organiser: { name: "Jordi", avatarInitial: "J", runs: 41, rating: 4.7, verified: true }
  },
  {
    id: "bcn-4",
    city: "bcn",
    locationName: "Collserola ridge",
    route: "Tibidabo -> Sant Pere Martir",
    lat: 41.4219,
    lng: 2.119,
    day: "SAT",
    runDate: "2026-05-09",
    time: "07:30",
    paceMin: "5:30",
    paceMax: "6:00",
    distanceKm: 12,
    goal: "Trail",
    spotsTotal: 1,
    spotsTaken: 1,
    womenOnly: false,
    status: "full",
    clubName: "Collserola Trail Club",
    organiser: { name: "Pau", avatarInitial: "P", runs: 67, rating: 5, verified: true }
  }
];

export function getSeedRuns(city: CitySlug): Run[] {
  return seedRuns.filter((run) => run.city === city);
}

export function paceLabel(run: Pick<Run, "paceMin" | "paceMax">) {
  return `${run.paceMin}-${run.paceMax}`;
}

export function openSpots(run: Pick<Run, "spotsTotal" | "spotsTaken">) {
  return Math.max(0, run.spotsTotal - run.spotsTaken);
}

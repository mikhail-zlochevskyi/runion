import { RunionMobileApp } from "@/components/runion-mobile-app";
import { DEFAULT_CITY } from "@/lib/config";
import { getSeedRuns } from "@/lib/runs";

export default function Home() {
  return <RunionMobileApp initialCity={DEFAULT_CITY} initialRuns={getSeedRuns(DEFAULT_CITY)} />;
}

import { RunionMobileApp } from "@/components/runion-mobile-app";
import { DEFAULT_CITY } from "@/lib/config";

export default function MapPage() {
  return <RunionMobileApp initialCity={DEFAULT_CITY} />;
}

import { RunionMobileApp } from "@/components/runion-mobile-app";
import { DEFAULT_CITY } from "@/lib/config";

export default function ProfilePage() {
  return <RunionMobileApp initialCity={DEFAULT_CITY} />;
}

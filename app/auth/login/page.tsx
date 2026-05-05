import { RunionMobileApp } from "@/components/runion-mobile-app";
import { DEFAULT_CITY } from "@/lib/config";

export default function LoginPage() {
  return <RunionMobileApp initialCity={DEFAULT_CITY} />;
}

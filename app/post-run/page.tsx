import { RunionMobileApp } from "@/components/runion-mobile-app";
import { DEFAULT_CITY } from "@/lib/config";

export default function PostRunPage() {
  return <RunionMobileApp initialCity={DEFAULT_CITY} />;
}

import { redirect } from "next/navigation";
import { DEFAULT_CITY } from "@/lib/config";

export default function Home() {
  redirect(`/map#${DEFAULT_CITY}`);
}

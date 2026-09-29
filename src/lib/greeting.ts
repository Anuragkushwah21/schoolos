import { SCHOOL_TIME_ZONE } from "@/lib/dates";

/** The greeting for the school's time of day — the school's morning, not the server's. */
export function greetingKey(now = new Date()): "greeting.morning" | "greeting.afternoon" | "greeting.evening" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: SCHOOL_TIME_ZONE }).format(now));
  if (hour < 12) return "greeting.morning";
  if (hour < 17) return "greeting.afternoon";
  return "greeting.evening";
}

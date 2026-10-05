import { ViewTabs } from "@/components/shared/view-tabs";

/**
 * Admissions, split by where they came from — never one mixed list:
 *
 *   * Online admissions: applications parents sent through the school's
 *     public admission form (set up under Website → Admission form).
 *   * Walk-in admissions: families the office entered itself — walk-ins,
 *     phone calls, referrals — followed up as enquiries and converted child
 *     by child into students.
 */
export function AdmissionTabs({ active, counts }: { active: "online" | "walkin"; counts?: { online?: number; walkin?: number } }) {
  return (
    <ViewTabs
      label="Admissions by source"
      tabs={[
        { href: "/school-admin/admissions", label: "Online admissions", count: counts?.online, active: active === "online" },
        { href: "/school-admin/admissions/enquiries", label: "Walk-in admissions", count: counts?.walkin, active: active === "walkin" },
      ]}
    />
  );
}

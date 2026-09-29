import { DashboardSkeleton } from "@/components/shared/skeletons";

/** Shown while this page's data is queried. */
export default function Loading() {
  return <DashboardSkeleton stats={4} />;
}

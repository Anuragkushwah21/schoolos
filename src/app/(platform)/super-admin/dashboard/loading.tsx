import { DashboardSkeleton } from "@/components/shared/skeletons";

/**
 * Shown while the dashboard's own queries run.
 *
 * Shaped like the page that follows, so the header and sidebar stay usable
 * and nothing jumps when the data lands.
 */
export default function Loading() {
  return <DashboardSkeleton stats={4} />;
}

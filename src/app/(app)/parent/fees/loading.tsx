import { DashboardSkeleton } from "@/components/shared/skeletons";

/** Shown while each child's fees are read. */
export default function Loading() {
  return <DashboardSkeleton stats={4} />;
}

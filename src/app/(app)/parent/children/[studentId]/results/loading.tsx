import { DashboardSkeleton } from "@/components/shared/skeletons";

/** The child's page, while their records load. */
export default function Loading() {
  return <DashboardSkeleton stats={4} />;
}

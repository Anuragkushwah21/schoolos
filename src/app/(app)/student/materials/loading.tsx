import { ListPageSkeleton } from "@/components/shared/skeletons";

/** The list, while it is queried. */
export default function Loading() {
  return <ListPageSkeleton columns={5} />;
}

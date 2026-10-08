import { ListPageSkeleton } from "@/components/shared/skeletons";

/** Shown while this list is queried — the filters and table hold their space. */
export default function Loading() {
  return <ListPageSkeleton columns={5} />;
}

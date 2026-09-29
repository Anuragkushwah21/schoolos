import { ListCardSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";

/** Shown while the homework and its resources load. */
export default function Loading() {
  return (
    <div aria-busy="true">
      <PageHeaderSkeleton withActions={false} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <ListCardSkeleton rows={3} />
        <ListCardSkeleton rows={3} />
      </div>
    </div>
  );
}

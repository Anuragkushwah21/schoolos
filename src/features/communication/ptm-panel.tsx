import { UsersIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import type { TenantContext } from "@/server/auth/current-user";
import { ptmClassList } from "@/server/communication/ptm";

import { PtmSectionList } from "./ptm-forms";

/**
 * The families of a PTM, class by class: who answered what, and — once the
 * meeting has started — what actually happened. Staff only; the service
 * limits a teacher to their own classes.
 */
export async function PtmFamiliesPanel({ ctx, meetingId }: { ctx: TenantContext; meetingId: string }) {
  const list = await ptmClassList(ctx, meetingId);
  const { summary } = list;
  if (!list.sections.length) {
    return (
      <EmptyState icon={UsersIcon} tone="neutral" title="No families on this list">
        This meeting is not for parents, or none of its classes are yours.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard tone="green" label="Will attend" value={summary.willAttend} hint={`of ${summary.families} families`} />
        <StatCard tone="amber" label="Unable to attend" value={summary.unable} />
        <StatCard tone="blue" label="Not responded" value={summary.notResponded} />
        <StatCard tone="purple" label="Attended" value={summary.attended} hint={`${summary.recorded} recorded`} />
      </div>
      {!list.canRecordNow && list.ptm.status !== "CANCELLED" ? <p className="text-muted-foreground text-sm">Attendance can be recorded once the meeting starts. Until then, parents can answer.</p> : null}
      {list.ptm.status === "CANCELLED" ? <p className="text-muted-foreground text-sm">This meeting was cancelled — nothing can be recorded.</p> : null}
      {list.sections.map((section) => (
        <PtmSectionList key={section.sectionId} meetingId={list.ptm.id} label={section.label} families={section.families} canRecord={section.canRecord && list.canRecordNow} />
      ))}
    </div>
  );
}

import type { Route } from "next";
import { ClipboardListIcon } from "lucide-react";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, toDateInput, today } from "@/lib/dates";
import { param } from "@/lib/search-params";
import type { TenantContext } from "@/server/auth/current-user";
import {
  RESPONSIBILITY_VIEWS,
  type ResponsibilityRow,
  type ResponsibilityView,
  assignablePeople,
  listResponsibilities,
  myResponsibilities,
  responsibilitySummary,
} from "@/server/responsibilities/service";

import {
  cancelResponsibilityAction,
  completeResponsibilityAction,
  confirmResponsibilityAction,
  reopenResponsibilityAction,
  startResponsibilityAction,
} from "./actions";
import { ProgressForm, ResponsibilityEditForm, ResponsibilityForm } from "./forms";

export const STATUS: Record<ResponsibilityRow["shownStatus"], { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "warning" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  COMPLETED: { label: "Completed", tone: "positive" },
  OVERDUE: { label: "Overdue", tone: "negative" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const VIEW_LABEL: Record<ResponsibilityView, string> = {
  all: "All",
  mine: "Given to me",
  assigned: "Given by me",
  pending: "Pending",
  overdue: "Overdue",
  completed: "Completed",
  cancelled: "Cancelled",
};

function Meta({ row, showAssignee }: { row: ResponsibilityRow; showAssignee: boolean }) {
  const parts = [
    row.typeLabel,
    showAssignee ? `To ${row.assignedToName}` : row.assignedByName ? `From ${row.assignedByName}` : null,
    row.endDate ? `Due ${formatDate(row.endDate)}` : `From ${formatDate(row.startDate)}`,
    row.priority === "HIGH" ? "High priority" : null,
  ].filter(Boolean);
  return <p className="text-muted-foreground text-sm">{parts.join(" · ")}</p>;
}

/** The assignee's own list: start, note progress, mark done. */
function MyList({ rows }: { rows: ResponsibilityRow[] }) {
  if (!rows.length) return <EmptyState title="No responsibilities yet">When the Principal or School Admin gives you one, it shows here.</EmptyState>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const open = row.status === "PENDING" || row.status === "IN_PROGRESS" || row.status === "OVERDUE";
        return (
          <li key={row.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{row.title}</span>
                  <StatusBadge status={row.shownStatus} label={STATUS[row.shownStatus].label} tone={STATUS[row.shownStatus].tone} />
                  {row.confirmedAt ? <StatusBadge status="CONFIRMED" label="Confirmed" tone="positive" /> : null}
                </div>
                <Meta row={row} showAssignee={false} />
                {row.description ? <p className="text-sm whitespace-pre-line">{row.description}</p> : null}
                {row.notes ? <p className="text-muted-foreground text-xs">{`Note: ${row.notes}`}</p> : null}
                {open ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      {row.status === "PENDING" ? (
                        <ActionButton action={startResponsibilityAction} fields={{ responsibilityId: row.id }} variant="outline">
                          Start
                        </ActionButton>
                      ) : null}
                      <ActionButton
                        action={completeResponsibilityAction}
                        fields={{ responsibilityId: row.id }}
                        confirm={{ title: "Mark as completed?", description: "The person who gave it to you will review it." }}
                      >
                        Mark completed
                      </ActionButton>
                    </div>
                    <ProgressForm id={row.id} note={row.progressNote} />
                  </div>
                ) : row.progressNote ? (
                  <p className="text-sm">{`Progress: ${row.progressNote}`}</p>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** For teachers and staff: only their own responsibilities. */
export async function MyResponsibilitiesScreen({ ctx }: { ctx: TenantContext }) {
  const rows = await myResponsibilities(ctx);
  return (
    <>
      <PageHeader icon={ClipboardListIcon} tone="purple" title="My responsibilities" description="Duties given to you by the Principal or School Admin. Start them, note your progress and mark them done." />
      <MyList rows={rows} />
    </>
  );
}

/**
 * The School Admin's and Principal's workspace: assign, follow, review and
 * confirm. The services check every permission again.
 */
export async function ResponsibilitiesScreen({ ctx, search, base }: { ctx: TenantContext; search: Record<string, string | string[] | undefined>; base: Route }) {
  const requested = param(search.view) as ResponsibilityView | undefined;
  const view: ResponsibilityView = requested && RESPONSIBILITY_VIEWS.includes(requested) ? requested : "all";
  const [summary, people] = await Promise.all([responsibilitySummary(ctx), assignablePeople(ctx)]);
  const now = today();
  const todayInput = toDateInput(now);
  const options = people.map((person) => ({ id: person.id, label: person.label }));

  const counts: Partial<Record<ResponsibilityView, number>> = {
    mine: summary.mine.pending + summary.mine.overdue,
    assigned: summary.assigned.pending + summary.assigned.overdue,
    pending: summary.all.pending,
    overdue: summary.all.overdue,
    completed: summary.all.completed,
  };

  return (
    <>
      <PageHeader icon={ClipboardListIcon} tone="purple" title="Responsibilities" description="Give duties to teachers and staff, follow their progress and confirm completed work. A responsibility never gives extra access." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          <ViewTabs
            label="Show"
            tabs={RESPONSIBILITY_VIEWS.map((key) => ({ href: key === "all" ? base : `${base}?view=${key}`, label: VIEW_LABEL[key], count: counts[key], active: key === view }))}
          />
          {summary.all.awaitingReview ? (
            <p className="bg-info-soft text-info-strong mb-4 rounded-xl border px-4 py-3 text-sm">{`${summary.all.awaitingReview} completed — waiting for you to review and confirm.`}</p>
          ) : null}
          {view === "mine" ? <MyList rows={await myResponsibilities(ctx)} /> : <LeadList ctx={ctx} view={view} people={options} today={todayInput} />}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Assign a responsibility</CardTitle>
          </CardHeader>
          <CardContent>
            {options.length ? <ResponsibilityForm people={options} today={todayInput} /> : <p className="text-muted-foreground text-sm">Add teachers or staff first.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

async function LeadList({ ctx, view, people, today: todayInput }: { ctx: TenantContext; view: ResponsibilityView; people: Array<{ id: string; label: string }>; today: string }) {
  const rows = await listResponsibilities(ctx, view);
  if (!rows.length) return <EmptyState title="Nothing here">Assign a responsibility with the form.</EmptyState>;
  const isAdmin = ctx.user.role === "SCHOOL_ADMIN";
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const manageable = isAdmin || row.assignedToId !== ctx.user.id;
        const open = row.status !== "COMPLETED" && row.status !== "CANCELLED";
        // Keep the current assignee in the list even if they are not assignable now.
        const choices = people.some((person) => person.id === row.assignedToId) ? people : [{ id: row.assignedToId, label: row.assignedToName }, ...people];
        return (
          <li key={row.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{row.title}</span>
                  <StatusBadge status={row.shownStatus} label={STATUS[row.shownStatus].label} tone={STATUS[row.shownStatus].tone} />
                  {row.confirmedAt ? <StatusBadge status="CONFIRMED" label="Confirmed" tone="positive" /> : null}
                </div>
                <Meta row={row} showAssignee />
                {row.description ? <p className="text-sm whitespace-pre-line">{row.description}</p> : null}
                {row.progressNote ? <p className="text-sm">{`Progress: ${row.progressNote}`}</p> : null}
                <p className="text-muted-foreground text-xs">{row.assignedByName ? `Given by ${row.assignedByName} on ${formatDate(row.createdAt)}` : `Given on ${formatDate(row.createdAt)}`}</p>
                {manageable ? (
                  <div className="flex flex-wrap gap-2">
                    {row.status === "COMPLETED" && !row.confirmedAt ? (
                      <>
                        <ActionButton action={confirmResponsibilityAction} fields={{ responsibilityId: row.id }}>
                          Confirm done
                        </ActionButton>
                        <ActionButton action={reopenResponsibilityAction} fields={{ responsibilityId: row.id }} variant="outline">
                          Send back
                        </ActionButton>
                      </>
                    ) : null}
                    {open ? (
                      <ActionButton
                        action={cancelResponsibilityAction}
                        fields={{ responsibilityId: row.id }}
                        variant="outline"
                        confirm={{ title: "Cancel this responsibility?", description: `${row.assignedToName} will see it as cancelled.`, confirmLabel: "Cancel it" }}
                      >
                        Cancel
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
                {manageable && open ? (
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-xs font-medium">Edit or reassign</summary>
                    <div className="mt-3">
                      <ResponsibilityEditForm
                        people={choices}
                        today={todayInput}
                        existing={{
                          id: row.id,
                          title: row.title,
                          description: row.description,
                          type: row.type,
                          assignedToId: row.assignedToId,
                          startDate: toDateInput(row.startDate),
                          endDate: row.endDate ? toDateInput(row.endDate) : "",
                          priority: row.priority,
                          notes: row.notes,
                        }}
                      />
                    </div>
                  </details>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

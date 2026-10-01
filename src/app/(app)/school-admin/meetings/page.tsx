import { HandshakeIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { StatCard } from "@/components/shared/stat-card";
import { LifecycleBadge } from "@/components/shared/lifecycle-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { enumParam, pageParam, param } from "@/lib/search-params";
import { MEETING_TIME_STATUSES, MEETING_TYPES } from "@/lib/validation/meetings";
import { deleteMeetingAction } from "@/features/communication/meeting-actions";
import { requireTenant } from "@/server/auth/current-user";
import { listMeetingsForAdmin } from "@/server/communication/meetings";

export const metadata: Metadata = { title: "Meetings" };

const TYPE_LABEL = { PTM: "Parent-teacher meeting", GENERAL: "Other meeting" } as const;

/**
 * Every meeting the school has called. Status is worked out from the clock on
 * each request — nothing needs marking as completed after the day.
 */
export default async function AdminMeetingsPage(props: PageProps<"/school-admin/meetings">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const filters = {
    q: param(search.q),
    status: enumParam(search.status, MEETING_TIME_STATUSES),
    type: enumParam(search.type, MEETING_TYPES),
    page: pageParam(search.page),
  };
  const { rows, total, page, pageCount, counts } = await listMeetingsForAdmin(ctx, filters);

  return (
    <>
      <PageHeader icon={HandshakeIcon} tone="cyan"
        title="Meetings / PTM"
        description="Parent-teacher meetings, staff meetings and anything else people need to turn up for. Invitees see them in their own portal."
        actions={
          <Button asChild>
            <Link href="/school-admin/meetings/new">
              <PlusIcon aria-hidden />
              Create meeting
            </Link>
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {MEETING_TIME_STATUSES.map((status) => (
          <StatCard
            key={status}
            href={`/school-admin/meetings?status=${status}` as Route}
            label={status === "UPCOMING" ? "Upcoming" : status === "ONGOING" ? "Happening now" : status === "COMPLETED" ? "Completed" : "Cancelled"}
            value={counts[status]}
          />
        ))}
      </div>
      <FilterBar
        action="/school-admin/meetings"
        search={{ defaultValue: filters.q, placeholder: "Title, message or location" }}
        selects={[
          {
            name: "status",
            label: "Status",
            defaultValue: filters.status,
            allLabel: "Any status",
            options: [
              { value: "UPCOMING", label: "Upcoming" },
              { value: "ONGOING", label: "Ongoing" },
              { value: "COMPLETED", label: "Completed" },
              { value: "CANCELLED", label: "Cancelled" },
            ],
          },
          {
            name: "type",
            label: "Kind",
            defaultValue: filters.type,
            allLabel: "Any kind",
            options: MEETING_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] })),
          },
        ]}
      />
      {rows.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meeting</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="hidden lg:table-cell">Invited</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((meeting) => (
                <TableRow key={meeting.id}>
                  <TableCell className="max-w-sm whitespace-normal">
                    <Link href={`/school-admin/meetings/${meeting.id}` as Route} className="font-medium hover:underline">
                      {meeting.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {TYPE_LABEL[meeting.type]}
                      {meeting.location ? ` · ${meeting.location}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(meeting.date)}
                    <span className="text-muted-foreground block text-xs">{meeting.time}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-xs whitespace-normal lg:table-cell">{meeting.audience}</TableCell>
                  <TableCell>
                    <LifecycleBadge status={meeting.stage} countdown={meeting.countdown} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {meeting.timeStatus === "UPCOMING" || meeting.timeStatus === "CANCELLED" ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/school-admin/meetings/${meeting.id}#edit` as Route}>
                            <PencilIcon aria-hidden />
                            {meeting.timeStatus === "CANCELLED" ? "Reschedule" : "Edit"}
                          </Link>
                        </Button>
                      ) : null}
                      <ActionButton
                        action={deleteMeetingAction}
                        fields={{ meetingId: meeting.id }}
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        confirm={{ title: `Delete "${meeting.title}"?`, description: "It disappears from everyone's list. This cannot be undone. To keep it visible as called off, cancel it instead.", confirmLabel: "Delete" }}
                      >
                        <Trash2Icon aria-hidden />
                        Delete
                      </ActionButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title={filters.q || filters.status || filters.type ? "No meetings match" : "No meetings yet"}>
          Schedule a parent-teacher meeting, a staff meeting or a class assembly, and choose who is invited.
        </EmptyState>
      )}
      <Pager page={page} pageCount={pageCount} total={total} basePath="/school-admin/meetings" params={{ q: filters.q, status: filters.status, type: filters.type }} />
    </>
  );
}

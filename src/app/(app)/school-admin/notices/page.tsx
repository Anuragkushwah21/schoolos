import type { Metadata } from "next";
import Link from "next/link";
import { GlobeIcon, MegaphoneIcon, PlusIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TimeStatusBadge } from "@/components/shared/time-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, today } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { noticeStatus } from "@/lib/time-status";
import { requireTenant } from "@/server/auth/current-user";
import { listNoticesForAdmin } from "@/server/communication/notices";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViewTabs } from "@/components/shared/view-tabs";
import { param } from "@/lib/search-params";
import type { Route } from "next";

function scopeLabel(notice: { scope: string; class: { name: string } | null; section: { name: string; class: { name: string } } | null; stream: { name: string } | null }): string {
  if (notice.scope === "CLASS") return notice.class?.name ?? "One class";
  if (notice.scope === "SECTION") return notice.section ? `${notice.section.class.name} ${notice.section.name}` : "One section";
  if (notice.scope === "STREAM") return notice.stream ? `${notice.stream.name} stream` : "One stream";
  return "Particular students";
}

export const metadata: Metadata = { title: "Notices" };

const KIND_LABEL = { NOTICE: "Notices", ANNOUNCEMENT: "Announcements", EMERGENCY: "Emergency alerts" } as const;
type Kind = keyof typeof KIND_LABEL;

export default async function AdminNoticesPage(props: PageProps<"/school-admin/notices">) {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const asked = param((await props.searchParams).kind);
  const kind = asked && asked in KIND_LABEL ? (asked as Kind) : undefined;
  const notices = await listNoticesForAdmin(ctx, undefined, kind);
  const now = new Date();

  return (
    <>
      <PageHeader icon={MegaphoneIcon} tone="amber"
        back={{ href: "/school-admin/communication" as Route, label: "Communication" }}
        title={kind ? KIND_LABEL[kind] : "Notices, announcements & alerts"}
        description="For staff, students and parents — by role, class, section or stream — and optionally the public website."
        actions={
          <Button asChild>
            <Link href={(kind ? `/school-admin/notices/new?kind=${kind}` : "/school-admin/notices/new") as Route}>
              <PlusIcon aria-hidden />
              {kind === "EMERGENCY" ? "Send emergency alert" : kind === "ANNOUNCEMENT" ? "New announcement" : "Create notice"}
            </Link>
          </Button>
        }
      />
      <ViewTabs
        label="Message type"
        tabs={[
          { href: "/school-admin/notices" as Route, label: "All", active: !kind },
          ...(Object.keys(KIND_LABEL) as Kind[]).map((value) => ({ href: `/school-admin/notices?kind=${value}` as Route, label: KIND_LABEL[value], active: kind === value })),
        ]}
      />
      {notices.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Notice</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Dates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notices.map((notice) => {
                const timeStatus = noticeStatus(notice.status, notice.publishAt, notice.expiresAt, today(now));
                return (
                  <TableRow key={notice.id}>
                    <TableCell className="max-w-md whitespace-normal">
                      <Link href={`/school-admin/notices/${notice.id}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
                        {notice.kind === "EMERGENCY" ? <StatusBadge status="EMERGENCY" tone="negative" label="Emergency" /> : notice.kind === "ANNOUNCEMENT" ? <StatusBadge status="ANNOUNCEMENT" tone="info" label="Announcement" /> : null}
                        {notice.title}
                        {notice.isPublic ? <GlobeIcon className="text-muted-foreground size-3.5" aria-label="On the public website" /> : null}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {notice.author ? `${notice.author.firstName} ${notice.author.lastName}` : "—"}
                      </p>
                    </TableCell>
                    <TableCell>
                      {notice.audience === "ALL" ? "Everyone" : notice.audience === "NON_TEACHING_STAFF" ? "Staff" : humanize(notice.audience)}
                      {notice.scope !== "SCHOOL" ? <span className="text-muted-foreground block text-xs">{scopeLabel(notice)}</span> : null}
                    </TableCell>
                    <TableCell>
                      <TimeStatusBadge status={timeStatus} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">
                      {notice.publishAt ? formatDate(notice.publishAt) : "—"}
                      {notice.expiresAt ? ` → ${formatDate(notice.expiresAt)}` : ""}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No notices yet."
          action={
            <Button asChild>
              <Link href="/school-admin/notices/new">Create notice</Link>
            </Button>
          }
        >
          Share holidays, exam dates or timing changes with parents, students and staff.
        </EmptyState>
      )}
    </>
  );
}

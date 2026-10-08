import type { Metadata, Route } from "next";
import Link from "next/link";
import { CalendarRangeIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdmissionTabs } from "@/features/admissions/admission-tabs";
import { DriveForm } from "@/features/admissions/drive-forms";
import { DRIVE_STATE_LABEL } from "@/lib/admission-drives";
import { formatDate } from "@/lib/dates";
import { listAcademicSessions } from "@/server/academics/structure";
import { listDrives } from "@/server/admissions/drives";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Admission drives" };

const STATE_TONE = { UPCOMING: "neutral", RUNNING: "positive", ENDED: "neutral", PAUSED: "warning", CLOSED: "neutral", CANCELLED: "negative" } as const;

/**
 * Admission drives: admissions opened for a session between two dates, with
 * classes handed to teachers. Teachers enter applications; the School Admin
 * approves and admits.
 */
export default async function AdmissionDrivesPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN", "PRINCIPAL");
  const [drives, sessions] = await Promise.all([listDrives(ctx), listAcademicSessions(ctx)]);
  const pending = drives.reduce((sum, drive) => sum + drive.pendingReview, 0);

  return (
    <>
      <PageHeader
        icon={CalendarRangeIcon}
        tone="blue"
        title="Admission drives"
        description="Open admissions for a session, give each class to a teacher with their own dates and capacity, and approve what they send."
      />
      <AdmissionTabs active="drives" counts={{ drives: pending || undefined }} />

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_24rem]">
        {drives.length ? (
          <div className="bg-card shadow-card overflow-hidden rounded-2xl border border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drive</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Classes</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                  <TableHead className="text-right">To review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drives.map((drive) => (
                  <TableRow key={drive.id}>
                    <TableCell>
                      <Link href={`/school-admin/admissions/drives/${drive.id}` as Route} className="font-medium hover:underline">
                        {drive.name}
                      </Link>
                      <span className="text-muted-foreground block text-xs">{drive.academicSession.name}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(drive.startDate)} – {formatDate(drive.endDate)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={drive.state} label={DRIVE_STATE_LABEL[drive.state]} tone={STATE_TONE[drive.state]} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{drive.assignments}</TableCell>
                    <TableCell className="text-right tabular-nums">{drive.applications}</TableCell>
                    <TableCell className="text-right tabular-nums">{drive.pendingReview ? <strong>{drive.pendingReview}</strong> : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={CalendarRangeIcon} tone="blue" title="No admission drives yet">
            Create one to let chosen teachers take admissions for their classes.
          </EmptyState>
        )}

        <Card>
          <CardHeader>
            <CardTitle>New drive</CardTitle>
            <CardDescription>Next, assign classes or sections to teachers.</CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.length ? (
              <DriveForm sessions={sessions.map((session) => ({ value: session.id, label: session.name }))} />
            ) : (
              <p className="text-muted-foreground text-sm">Add an academic session first.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

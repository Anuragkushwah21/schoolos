import type { Route } from "next";
import Link from "next/link";
import { CalendarPlusIcon, HeartHandshakeIcon, MessageCircleHeartIcon, PhoneIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MessageKey } from "@/lib/i18n/translate";
import { formatDate, formatDateTime, formatMinutes } from "@/lib/dates";
import { telHref } from "@/server/attendance/absentees";
import { getIntlLocale, getT } from "@/server/i18n";
import type { SupportRow, getSupport } from "@/server/support/service";

import { FollowUpForm } from "./forms";

const k = (key: string) => key as MessageKey;

/** Students needing attention: a short table on wide screens, cards on phones. */
export async function SupportTable({ rows, basePath, showTeacher = false }: { rows: SupportRow[]; basePath: "/teacher/support" | "/school-admin/support"; showTeacher?: boolean }) {
  const t = await getT();
  if (!rows.length) {
    return (
      <EmptyState icon={HeartHandshakeIcon} tone="green" title={t("support.none")}>
        {t("support.noneHint")}
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`${basePath}/${row.id}` as Route} className="bg-card block rounded-2xl border p-4 shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{row.student}</span>
                <StatusBadge status={row.status} />
              </span>
              <span className="text-muted-foreground block text-sm">
                {row.section} · {row.subject ?? t("support.general")}
              </span>
              <span className="mt-1 block text-sm">{t(k(`support.reason.${row.reason}`))}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="bg-card hidden overflow-x-auto rounded-2xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("support.student")}</TableHead>
              <TableHead>{t("support.subject")}</TableHead>
              <TableHead>{t("support.reasonLabel")}</TableHead>
              <TableHead>{t("support.priorityLabel")}</TableHead>
              {showTeacher ? <TableHead className="hidden lg:table-cell">{t("support.teacher")}</TableHead> : null}
              <TableHead>{t("support.statusLabel")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`${basePath}/${row.id}` as Route} className="font-medium hover:underline">
                    {row.student}
                  </Link>
                  <span className="text-muted-foreground block text-xs">{row.section}</span>
                </TableCell>
                <TableCell>
                  {row.subject ?? t("support.general")}
                  {row.topic ? <span className="text-muted-foreground block text-xs">{row.topic}</span> : null}
                </TableCell>
                <TableCell className="max-w-xs whitespace-normal">
                  {t(k(`support.reason.${row.reason}`))}
                  <span className="text-muted-foreground block text-xs">{t(k(`support.action.${row.action}`))}</span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.priority} />
                </TableCell>
                {showTeacher ? <TableCell className="hidden lg:table-cell">{row.teacher ?? "—"}</TableCell> : null}
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.fromConcern ? <span className="text-muted-foreground mt-1 block text-xs">{t("support.fromParents")}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** One support record for staff: what, why, what is being done, and the follow-ups. */
export async function SupportDetailView({
  support,
  extraClassHref,
  concernBasePath = "/school-admin/concerns",
}: {
  support: Awaited<ReturnType<typeof getSupport>>;
  /** Where the linked concern's conversation lives for this viewer. */
  concernBasePath?: "/school-admin/concerns" | "/teacher/concerns";
  /** School Admin: where "Schedule extra class" goes, when one is recommended. */
  extraClassHref?: Route | null;
}) {
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  const rows: Array<[string, React.ReactNode]> = [
    [t("support.subject"), `${support.subject ?? t("support.general")}${support.topic ? ` — ${support.topic}` : ""}`],
    [t("support.reasonLabel"), `${t(k(`support.reason.${support.reason}`))}${support.reasonNote ? ` — ${support.reasonNote}` : ""}`],
    [t("support.actionLabel"), `${t(k(`support.action.${support.action}`))}${support.actionNote ? ` — ${support.actionNote}` : ""}`],
    [t("support.priorityLabel"), <StatusBadge key="p" status={support.priority} />],
    [t("support.teacher"), support.teacher ?? "—"],
    [t("support.source"), t(k(`support.sourceLabel.${support.source}`))],
    ["", t("support.since", { date: formatDate(support.createdAt, intl) })],
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {support.student}
              <StatusBadge status={support.status} />
            </CardTitle>
            <CardDescription>
              {support.section} · {support.admissionNumber}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              {rows.map(([label, value], index) => (
                <div key={index} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {support.action === "EXTRA_CLASS" || support.extraClass ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("support.extraClass")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-3 text-sm">
              {support.extraClass ? (
                <p className="flex flex-wrap items-center gap-2">
                  {support.extraClass.title} · {t("support.extraClassOn", { date: formatDate(support.extraClass.date, intl), time: formatMinutes(support.extraClass.startMinute) })}
                  {support.extraClass.status === "CANCELLED" ? <StatusBadge status="CANCELLED" /> : null}
                </p>
              ) : extraClassHref ? (
                <Button asChild>
                  <Link href={extraClassHref}>
                    <CalendarPlusIcon aria-hidden />
                    {t("support.scheduleExtraClass")}
                  </Link>
                </Button>
              ) : (
                <p className="text-muted-foreground">{t("status.SUPPORT_PLANNED")}</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {support.concern ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <MessageCircleHeartIcon className="text-info size-5" aria-hidden />
                {support.concern.ref}
                <StatusBadge status={support.concern.status} />
              </CardTitle>
              {support.concern.parent ? <CardDescription>{t("support.concernFrom", { parent: support.concern.parent })}</CardDescription> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="font-medium">{t(k(`concerns.types.${support.concern.type}`))}</p>
              {support.concern.message ? <p className="bg-muted rounded-lg px-3 py-2 whitespace-pre-wrap">{support.concern.message}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`${concernBasePath}/${support.concern.id}` as Route}>{t("concerns.conversation")} →</Link>
                </Button>
                {support.concern.parentPhone ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={telHref(support.concern.parentPhone)}>
                      <PhoneIcon aria-hidden />
                      {support.concern.parentPhone}
                    </a>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        {support.mayEdit ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("support.followUp")}</CardTitle>
            </CardHeader>
            <CardContent>
              <FollowUpForm supportId={support.id} current={support.status} />
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{t("support.followUps")}</CardTitle>
          </CardHeader>
          <CardContent>
            {support.notes.length ? (
              <ol className="flex flex-col divide-y text-sm">
                {support.notes.map((note) => (
                  <li key={note.id} className="flex flex-col gap-1 py-2.5">
                    {note.toStatus ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {note.fromStatus ? <StatusBadge status={note.fromStatus} /> : null}
                        <span aria-hidden>→</span>
                        <StatusBadge status={note.toStatus} />
                      </span>
                    ) : null}
                    {note.note ? <span>{note.note}</span> : null}
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(note.createdAt, intl)}
                      {note.author ? ` · ${note.author}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">{t("support.noFollowUps")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import type { Route } from "next";
import Link from "next/link";
import { BellRingIcon, BuildingIcon, LockIcon, MessagesSquareIcon, PhoneIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import { telHref } from "@/server/attendance/absentees";
import { getIntlLocale, getT } from "@/server/i18n";
import type { ConcernDetail, ConcernRow } from "@/server/support/concerns";

import { AssignConcernForm, ConcernStatusButtons, RequestUpdateForm } from "./forms";

const k = (key: string) => key as MessageKey;

type Base = "/school-admin/concerns" | "/teacher/concerns" | "/parent/concerns";

async function Flags({ updateRequested, withOffice }: { updateRequested: boolean; withOffice: boolean }) {
  const t = await getT();
  return (
    <>
      {updateRequested ? (
        <span className="bg-danger-soft text-danger-strong inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
          <BellRingIcon className="size-3" aria-hidden />
          {t("concerns.updateRequestedBadge")}
        </span>
      ) : null}
      {withOffice ? (
        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
          <BuildingIcon className="size-3" aria-hidden />
          {t("concerns.withOffice")}
        </span>
      ) : null}
    </>
  );
}

/**
 * Concerns as cards: student and class, subject, what was raised, who raised
 * it, the teacher, and the status — with the teacher's two buttons when
 * `actions` is set.
 */
export async function ConcernCards({ rows, basePath, actions = false }: { rows: ConcernRow[]; basePath: Base; actions?: boolean }) {
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  if (!rows.length) {
    return (
      <EmptyState icon={MessagesSquareIcon} tone="blue" title={t("concerns.none")}>
        {t("concerns.noneHint")}
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className={cn("bg-card flex flex-col gap-2 rounded-2xl border p-4 shadow-[0_1px_3px_rgb(15_23_42/0.06)]", actions && row.status === "OPEN" && "border-warning")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">{row.student}</p>
              <p className="text-muted-foreground text-sm">
                {row.group ?? "—"} · <span className="text-foreground font-medium">{row.subject ?? "—"}</span>
              </p>
            </div>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={row.status} />
              <Flags updateRequested={row.updateRequested && basePath !== "/parent/concerns"} withOffice={!row.teacher} />
            </span>
          </div>
          {row.message ? <blockquote className="bg-muted rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">“{row.message}”</blockquote> : null}
          <p className="text-muted-foreground text-xs">
            {t("concerns.raisedBy")}: {t(k(`concerns.source.${row.raisedBy}`))} · {t("concerns.teacher")}: {row.teacher ?? t("concerns.withOffice")}
            {row.teacherOnLeave ? ` (${t("concerns.onLeave")})` : ""} ·{" "}
            {formatDateTime(row.createdAt, intl)}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {actions ? <ConcernStatusButtons concernId={row.id} status={row.status} /> : <span />}
            <Link href={`${basePath}/${row.id}` as Route} className="text-primary text-sm font-medium hover:underline">
              {t("concerns.details")} →
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The School Admin's table: every concern in the school. */
export async function ConcernTable({ rows, basePath }: { rows: ConcernRow[]; basePath: Base }) {
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  if (!rows.length) {
    return (
      <EmptyState icon={MessagesSquareIcon} tone="blue" title={t("concerns.none")}>
        {t("concerns.noneHint")}
      </EmptyState>
    );
  }
  return (
    <>
      <div className="md:hidden">
        <ConcernCards rows={rows} basePath={basePath} />
      </div>
      <div className="bg-card hidden overflow-x-auto rounded-2xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("concerns.student")}</TableHead>
              <TableHead>{t("concerns.group")}</TableHead>
              <TableHead>{t("concerns.stream")}</TableHead>
              <TableHead>{t("concerns.subject")}</TableHead>
              <TableHead>{t("concerns.raisedBy")}</TableHead>
              <TableHead>{t("concerns.teacher")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("concerns.raisedOn")}</TableHead>
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
                </TableCell>
                <TableCell className="text-sm">{row.group?.split(" • ")[0] ?? "—"}</TableCell>
                <TableCell className="text-sm">{row.stream ?? "—"}</TableCell>
                <TableCell className="text-sm">{row.subject ?? "—"}</TableCell>
                <TableCell className="text-sm">{t(k(`concerns.source.${row.raisedBy}`))}</TableCell>
                <TableCell className="text-sm">
                  {row.teacher ?? <span className="text-muted-foreground">{t("concerns.withOffice")}</span>}
                  {row.teacherOnLeave ? <span className="bg-warning-soft text-warning-strong ms-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium">{t("concerns.onLeave")}</span> : null}
                </TableCell>
                <TableCell className="text-muted-foreground hidden text-sm lg:table-cell">{formatDate(row.createdAt, intl)}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={row.status} />
                    <Flags updateRequested={row.updateRequested} withOffice={false} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/**
 * One concern: the details, what was raised, its status history, and what
 * this person can do — the teacher (or office) moves the status; the office
 * can request action or hand it to a teacher; a parent only reads.
 */
export async function ConcernDetailView({ concern, teachers = [] }: { concern: ConcernDetail; teachers?: Array<{ value: string; label: string }> }) {
  const [t, intl] = await Promise.all([getT(), getIntlLocale()]);
  const staff = concern.viewer !== "PARENT";
  const facts: Array<[string, React.ReactNode]> = [
    [t("concerns.student"), concern.student],
    [t("concerns.group"), concern.group?.split(" • ")[0] ?? "—"],
    ...(concern.stream ? ([[t("concerns.stream"), concern.stream]] as Array<[string, React.ReactNode]>) : []),
    [t("concerns.subject"), concern.subject ?? "—"],
    [t("concerns.raisedBy"), `${t(k(`concerns.source.${concern.raisedBy}`))}${concern.raisedByParent ? ` — ${concern.raisedByParent}` : concern.raisedByTeacher ? ` — ${concern.raisedByTeacher}` : ""}`],
    [t("concerns.teacher"), `${concern.teacher ?? t("concerns.withOffice")}${concern.teacherOnLeave ? ` (${t("concerns.onLeave")})` : ""}`],
    [t("concerns.raisedOn"), formatDateTime(concern.createdAt, intl)],
    [t("support.statusLabel"), <StatusBadge key="s" status={concern.status} />],
  ];
  const history = concern.messages.slice(1);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t("concerns.concern")}
              {concern.updateRequested && staff ? <Flags updateRequested withOffice={false} /> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <blockquote className="bg-muted rounded-lg px-4 py-3 text-sm whitespace-pre-wrap">“{concern.message}”</blockquote>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {history.length ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("concerns.history")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col divide-y text-sm">
                {history.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 py-2.5">
                    {item.toStatus ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {item.fromStatus ? <StatusBadge status={item.fromStatus} /> : null}
                        <span aria-hidden>→</span>
                        <StatusBadge status={item.toStatus} />
                      </span>
                    ) : null}
                    {item.body ? (
                      <span className={cn(item.internal && "text-warning-strong")}>
                        {item.internal ? (
                          <span className="me-1 inline-flex items-center gap-1 text-xs font-semibold">
                            <LockIcon className="size-3" aria-hidden />
                            {t("concerns.staffOnly")}:
                          </span>
                        ) : null}
                        {item.body}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {item.author ?? t(k(`concerns.source.${item.authorRole}`))} · {formatDateTime(item.createdAt, intl)}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        {concern.mayChangeStatus ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("concerns.changeStatus")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ConcernStatusButtons concernId={concern.id} status={concern.status} withNote />
            </CardContent>
          </Card>
        ) : null}

        {concern.mayRequestUpdate ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("concerns.requestUpdate")}</CardTitle>
            </CardHeader>
            <CardContent>
              <RequestUpdateForm concernId={concern.id} />
            </CardContent>
          </Card>
        ) : null}

        {concern.mayAssign && teachers.length ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("concerns.assignTeacher")}</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignConcernForm concernId={concern.id} teachers={teachers} current={concern.teacherId} />
            </CardContent>
          </Card>
        ) : null}

        {staff && concern.parents.length ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("concerns.parents")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {concern.parents.map((parent) => (
                <div key={`${parent.name}${parent.phone}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{parent.name}</span>
                  <Button asChild variant="outline" size="sm">
                    <a href={telHref(parent.phone)}>
                      <PhoneIcon aria-hidden />
                      {parent.phone}
                    </a>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** On the support pages: how many concerns are open, and the way to them. */
export async function ConcernsBanner({ rows, href }: { rows: ConcernRow[]; href: Base }) {
  const t = await getT();
  if (!rows.length) return null;
  const waiting = rows.filter((row) => row.waitingOnMe).length;
  return (
    <Link
      href={href}
      className="bg-info-soft text-info-strong mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-3 text-sm font-medium hover:underline"
    >
      <MessagesSquareIcon className="size-5" aria-hidden />
      <span>{t("concerns.openCount", { count: rows.length })}</span>
      {waiting ? <span className="bg-warning-soft text-warning-strong rounded-full px-2 py-0.5 text-xs">{t("concerns.waitingOnYou")} · {waiting}</span> : null}
      <span className="ms-auto">{t("concerns.viewAll")} →</span>
    </Link>
  );
}

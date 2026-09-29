import { HistoryIcon } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonKind } from "@/generated/prisma/enums";
import { formatDate, formatDateTime, toDateInput, today } from "@/lib/dates";
import { EMPLOYEE_LIFECYCLE, LEFT_EMPLOYEE, LEFT_STUDENT, STUDENT_LIFECYCLE } from "@/lib/validation/lifecycle";
import type { TenantContext } from "@/server/auth/current-user";
import { getIntlLocale, getT } from "@/server/i18n";
import { parentStanding, personLifecycle } from "@/server/people/lifecycle";

import { ChangeStatusDialog, ManageLoginDialog } from "./lifecycle-dialogs";

/**
 * The one place on a profile where the office sees and changes where someone
 * stands:
 *
 *   Status: 🟢 Active     Login: 🟢 Active
 *   [Change status]  [Manage login]
 *   ▸ View history
 *
 * For a guardian there is no status to change — it follows their children —
 * so only the login is managed here.
 */
export async function LifecyclePanel({
  ctx,
  person,
  personId,
  childStatuses,
}: {
  ctx: TenantContext;
  person: PersonKind;
  personId: string;
  /** For a guardian: their children's statuses, from which their standing follows. */
  childStatuses?: string[];
}) {
  const [t, intl, info] = await Promise.all([getT(), getIntlLocale(), personLifecycle(ctx, person, personId)]);
  const status = person === "PARENT" ? parentStanding((childStatuses ?? []).map((status) => ({ status }))) : info.status;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("lifecycle.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-[6rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">{person === "PARENT" ? t("lifecycle.parentStanding") : t("lifecycle.status")}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            {info.leftOn ? <span className="text-muted-foreground text-xs">{t("lifecycle.leftOn", { date: formatDate(info.leftOn, intl) })}</span> : null}
          </dd>
          <dt className="text-muted-foreground">{t("lifecycle.login")}</dt>
          <dd className="flex flex-col gap-1">
            <StatusBadge status={info.login} />
            {info.login === "LOCKED" ? <span className="text-muted-foreground text-xs">{t("lifecycle.lockedHint")}</span> : null}
            {info.login === "NO_LOGIN" ? <span className="text-muted-foreground text-xs">{t("lifecycle.noLoginHint")}</span> : null}
          </dd>
        </dl>

        <div className="flex flex-wrap gap-2">
          {person !== "PARENT" ? (
            <ChangeStatusDialog
              person={person}
              personId={personId}
              name={info.name}
              current={info.status}
              statuses={person === "STUDENT" ? STUDENT_LIFECYCLE : EMPLOYEE_LIFECYCLE}
              left={person === "STUDENT" ? LEFT_STUDENT : LEFT_EMPLOYEE}
              today={toDateInput(today())}
            />
          ) : null}
          {info.login !== "NO_LOGIN" ? (
            <ManageLoginDialog person={person} personId={personId} name={info.name} login={info.login} maySignIn={info.maySignIn} />
          ) : null}
        </div>

        <details className="group rounded-lg border">
          <summary className="hover:bg-muted flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium">
            <HistoryIcon className="size-4" aria-hidden />
            {t("lifecycle.viewHistory")} ({info.history.length})
          </summary>
          <div className="border-t px-3 py-2">
            {info.history.length ? (
              <ol className="flex flex-col divide-y text-sm">
                {info.history.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 py-2.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground text-xs font-medium">{entry.kind === "LOGIN" ? t("lifecycle.login") : t("lifecycle.status")}:</span>
                      <StatusBadge status={entry.from} />
                      <span aria-hidden>→</span>
                      <StatusBadge status={entry.to} />
                      <span className="text-muted-foreground text-xs">{formatDate(entry.effectiveDate, intl)}</span>
                    </span>
                    {entry.reason ? <span>{entry.reason}</span> : null}
                    {entry.remarks ? <span className="text-muted-foreground text-xs">{entry.remarks}</span> : null}
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(entry.at, intl)}
                      {entry.changedBy ? ` · ${t("lifecycle.changedBy", { name: entry.changedBy })}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground py-2 text-sm">{t("lifecycle.noHistory")}</p>
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

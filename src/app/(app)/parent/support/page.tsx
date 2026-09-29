import type { Metadata } from "next";
import { HeartHandshakeIcon, MessageCircleHeartIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConcernForm } from "@/features/support/forms";
import { formatDate, formatMinutes } from "@/lib/dates";
import type { MessageKey } from "@/lib/i18n/translate";
import { requireTenant } from "@/server/auth/current-user";
import { getIntlLocale, getT } from "@/server/i18n";
import { familySupport, subjectsForChild } from "@/server/support/service";

export const metadata: Metadata = { title: "Support" };

const k = (key: string) => key as MessageKey;

/**
 * For a parent: the extra help each child is getting, in plain words, the
 * school's replies to their concerns, and a short form to raise one.
 */
export default async function ParentSupportPage() {
  const ctx = await requireTenant("PARENT");
  const [t, intl, family] = await Promise.all([getT(), getIntlLocale(), familySupport(ctx)]);
  const subjectsByChild = Object.fromEntries(await Promise.all(family.children.map(async (child) => [child.id, await subjectsForChild(ctx, child.id)] as const)));

  return (
    <>
      <PageHeader icon={HeartHandshakeIcon} tone="green" title={t("support.childSupport")} description={t("support.concernHint")} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <section aria-labelledby="child-support" className="flex flex-col gap-3">
            <h2 id="child-support" className="text-base font-semibold">
              {t("support.additionalSupport")}
            </h2>
            {family.supports.length ? (
              family.supports.map((row) => (
                <Card key={row.id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {row.child} — {row.subject ?? t("support.general")}
                      <StatusBadge status={row.status} />
                    </CardTitle>
                    <CardDescription>{t("support.additionalSupport")}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">{t("support.reasonLabel")}: </span>
                      {t(k(`support.reason.${row.reason}`))}
                      {row.topic ? ` — ${row.topic}` : ""}
                    </p>
                    <p>
                      <span className="text-muted-foreground">{t("support.actionLabel")}: </span>
                      {t(k(`support.action.${row.action}`))}
                      {row.actionNote ? ` — ${row.actionNote}` : ""}
                    </p>
                    {row.extraClass && row.extraClass.status !== "CANCELLED" ? (
                      <p className="bg-info-soft text-info-strong rounded-lg px-3 py-2">
                        {t("support.extraClassOn", { date: formatDate(row.extraClass.date, intl), time: formatMinutes(row.extraClass.startMinute) })}
                      </p>
                    ) : null}
                    {row.teacher ? <p className="text-muted-foreground text-xs">{row.teacher}</p> : null}
                  </CardContent>
                </Card>
              ))
            ) : (
              <EmptyState icon={HeartHandshakeIcon} tone="green" title={t("support.noChildSupport")} />
            )}
          </section>

          <section aria-labelledby="my-concerns" className="flex flex-col gap-3">
            <h2 id="my-concerns" className="text-base font-semibold">
              {t("support.yourConcerns")}
            </h2>
            {family.concerns.length ? (
              <ul className="flex flex-col gap-3">
                {family.concerns.map((concern) => (
                  <li key={concern.id} className="bg-card rounded-2xl border p-4 text-sm shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {concern.child} — {concern.subject ?? t("support.general")}
                      </span>
                      <StatusBadge status={concern.status} />
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t(k(`support.reason.${concern.reason}`))} · {formatDate(concern.createdAt, intl)}
                    </p>
                    {concern.status !== "NEW" ? <p className="mt-2 font-medium">{t("support.concernReviewed")}</p> : null}
                    {concern.response ? (
                      <p className="bg-success-soft text-success-strong mt-2 rounded-lg px-3 py-2">
                        <span className="font-medium">{t("support.schoolReply")}: </span>
                        {concern.response}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t("support.noConcerns")}</p>
            )}
          </section>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleHeartIcon className="text-info size-5" aria-hidden />
              {t("support.raiseConcern")}
            </CardTitle>
            <CardDescription>{t("support.concernHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {family.children.length ? (
              <ConcernForm childOptions={family.children.map((child) => ({ value: child.id, label: `${child.name}${child.sectionLabel ? ` · ${child.sectionLabel}` : ""}` }))} subjectsByChild={subjectsByChild} />
            ) : (
              <p className="text-muted-foreground text-sm">{t("lifecycle.noActiveChildren")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

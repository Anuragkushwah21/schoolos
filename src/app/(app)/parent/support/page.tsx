import type { Metadata } from "next";
import Link from "next/link";
import { HeartHandshakeIcon, MessageCircleHeartIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConcernsBanner } from "@/features/concerns/views";
import { formatDate, formatMinutes } from "@/lib/dates";
import type { MessageKey } from "@/lib/i18n/translate";
import { requireTenant } from "@/server/auth/current-user";
import { getIntlLocale, getT } from "@/server/i18n";
import { listConcerns } from "@/server/support/concerns";
import { familySupport } from "@/server/support/service";

export const metadata: Metadata = { title: "Support" };

const k = (key: string) => key as MessageKey;

/**
 * For a parent: the extra help each child is getting, in plain words, and
 * the way to their subject concerns (`/parent/concerns`).
 */
export default async function ParentSupportPage() {
  const ctx = await requireTenant("PARENT");
  const [t, intl, family, concerns] = await Promise.all([getT(), getIntlLocale(), familySupport(ctx), listConcerns(ctx)]);

  return (
    <>
      <PageHeader icon={HeartHandshakeIcon} tone="green" title={t("support.childSupport")} description={t("support.concernHint")} />
      <ConcernsBanner rows={concerns} href="/parent/concerns" />
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
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleHeartIcon className="text-info size-5" aria-hidden />
              {t("support.raiseConcern")}
            </CardTitle>
            <CardDescription>{t("concerns.parentHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href="/parent/concerns">{t("concerns.raise")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

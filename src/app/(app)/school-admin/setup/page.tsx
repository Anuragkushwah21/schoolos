import { ListChecksIcon } from "lucide-react";
import type { Metadata } from "next";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar, SetupStepList } from "@/features/school/setup-progress";
import { param } from "@/lib/search-params";
import { setupReport } from "@/server/academics/setup";
import { listAcademicSessions } from "@/server/academics/structure";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "School setup" };

/**
 * Every setup step for the school, or for one academic session — the page a
 * new school works through, and the one to open after promoting students into
 * a new session.
 */
export default async function SetupPage(props: PageProps<"/school-admin/setup">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const [t, sessions] = await Promise.all([getT(), listAcademicSessions(ctx)]);
  const report = await setupReport(ctx, { sessionId: param(search.session) });

  return (
    <>
      <PageHeader
        icon={ListChecksIcon}
        tone="blue"
        back={{ href: "/school-admin/dashboard", label: "Dashboard" }}
        title={report.session && !report.session.isCurrent ? t("setup.sessionTitle", { name: report.session.name }) : t("setup.title")}
        description={t("setup.progress", { percent: String(report.percent) })}
      />
      {sessions.length > 1 ? (
        <FilterBar
          action="/school-admin/setup"
          selects={[
            {
              name: "session",
              label: t("setup.otherSession"),
              defaultValue: report.session?.id,
              options: sessions.map((s) => ({ value: s.id, label: s.isCurrent ? `${s.name} ✓` : s.name })),
            },
          ]}
        />
      ) : null}
      <div className="mb-6 max-w-3xl">
        <ProgressBar percent={report.percent} />
      </div>
      {report.session && !report.session.isCurrent ? (
        <p className="text-muted-foreground mb-6 max-w-3xl rounded-lg border border-dashed p-3 text-sm">
          {t("setup.notCurrentHint", { name: report.session.name })}
        </p>
      ) : null}
      {report.complete ? (
        <Card className="mb-6 max-w-3xl">
          <CardHeader>
            <CardTitle>{t("setup.completeTitle")}</CardTitle>
            <CardDescription>{t("setup.completeBody")}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      <div className="max-w-3xl">
        <CardContent className="p-0">
          <SetupStepList report={report} />
        </CardContent>
      </div>
    </>
  );
}

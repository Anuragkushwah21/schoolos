import type { Metadata, Route } from "next";
import Link from "next/link";
import { HeartHandshakeIcon, PlusIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConcernList, SupportTable } from "@/features/support/views";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { listConcerns, listSupport, supportSuggestions } from "@/server/support/service";

export const metadata: Metadata = { title: "Student support" };

/**
 * A teacher's students needing attention in the classes they teach: parent
 * concerns to review first, then open support, then gentle suggestions from
 * their own recent remarks.
 */
export default async function TeacherSupportPage() {
  const ctx = await requireTenant("TEACHER");
  const [t, rows, concerns, suggestions] = await Promise.all([getT(), listSupport(ctx), listConcerns(ctx), supportSuggestions(ctx)]);

  return (
    <>
      <PageHeader
        icon={HeartHandshakeIcon}
        tone="green"
        title={t("support.title")}
        description={t("support.studentsNeeding", { count: new Set(rows.map((row) => row.studentId)).size })}
        actions={
          <Button asChild>
            <Link href="/teacher/support/new">
              <PlusIcon aria-hidden />
              {t("support.addSupport")}
            </Link>
          </Button>
        }
      />
      <ConcernList concerns={concerns} addHref={(concern) => `/teacher/support/new?student=${concern.studentId}&concern=${concern.id}` as Route} />
      <SupportTable rows={rows} basePath="/teacher/support" />
      {suggestions.length ? (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>{t("support.suggestions")}</CardTitle>
            <CardDescription>{t("support.suggestionsHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {suggestions.map((item) => (
                <li key={item.studentId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{item.student}</span>
                    <span className="text-muted-foreground block text-xs">
                      {item.subject ?? t("support.general")} · {item.on}
                    </span>
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/teacher/support/new?student=${item.studentId}${item.subjectId ? `&subject=${item.subjectId}` : ""}` as Route}>{t("support.addSupport")}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

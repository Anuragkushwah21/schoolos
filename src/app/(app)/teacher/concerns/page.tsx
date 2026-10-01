import type { Metadata } from "next";
import { MessageSquarePlusIcon, MessagesSquareIcon } from "lucide-react";

import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TeacherConcernForm } from "@/features/concerns/forms";
import { ConcernCards } from "@/features/concerns/views";
import { enumParam, param } from "@/lib/search-params";
import { CONCERN_STATUSES } from "@/lib/validation/support";
import { requireTenant } from "@/server/auth/current-user";
import { getT } from "@/server/i18n";
import { listConcerns, teacherConcernOptions } from "@/server/support/concerns";

export const metadata: Metadata = { title: "Concerns" };

/**
 * "Student Concerns" for a teacher: only concerns about the students and
 * subjects they teach, each with [Mark In Progress] / [Mark Resolved], and a
 * form to raise one where the subject comes from their assignment.
 */
export default async function TeacherConcernsPage(props: PageProps<"/teacher/concerns">) {
  const ctx = await requireTenant("TEACHER");
  const search = await props.searchParams;
  const status = enumParam(search.status, [...CONCERN_STATUSES, "ALL", "OPEN_ALL"] as const) ?? "OPEN_ALL";
  const [t, rows, students] = await Promise.all([getT(), listConcerns(ctx, { status, q: param(search.q) }), teacherConcernOptions(ctx)]);

  return (
    <>
      <PageHeader icon={MessagesSquareIcon} tone="blue" title={t("concerns.myTitle")} description={t("concerns.teacherHint")} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <FilterBar
            action="/teacher/concerns"
            search={{ defaultValue: param(search.q), placeholder: t("concerns.student") }}
            selects={[
              {
                name: "status",
                label: t("support.statusLabel"),
                defaultValue: status,
                options: [
                  { value: "OPEN_ALL", label: t("concerns.allOpen") },
                  ...CONCERN_STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
                  { value: "ALL", label: t("common.all") },
                ],
              },
            ]}
          />
          <ConcernCards rows={rows} basePath="/teacher/concerns" actions />
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquarePlusIcon className="text-info size-5" aria-hidden />
              {t("concerns.raiseForParent")}
            </CardTitle>
            <CardDescription>{t("concerns.raiseForParentHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {students.length ? <TeacherConcernForm students={students} /> : <p className="text-muted-foreground text-sm">{t("concerns.noAssignments")}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import type { Metadata, Route } from "next";
import { GraduationCapIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GradingRulesForm } from "@/features/exams/forms";
import { DEFAULT_BANDS, gradingKey } from "@/lib/grades";
import { requireTenant } from "@/server/auth/current-user";
import { gradingRules } from "@/server/exams/grading";

export const metadata: Metadata = { title: "Grading" };

/** The school's own grade scale and pass percentage. */
export default async function GradingSettingsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const rules = await gradingRules(ctx);
  const usingDefault = JSON.stringify(rules.bands) === JSON.stringify(DEFAULT_BANDS);
  return (
    <>
      <PageHeader back={{ href: "/school-admin/settings" as Route, label: "Settings" }} icon={GraduationCapIcon} tone="purple" title="Grading" description="How marks turn into grades and pass/fail on every result, report card and final result. Changing it updates them all — no marks are rewritten." />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardContent className="pt-6">
            <GradingRulesForm bandsText={rules.bands.map((band) => `${band.grade}: ${band.min}`).join("\n")} passPercent={rules.passPercent} usingDefault={usingDefault} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>In use now</CardTitle>
            <CardDescription>{`Pass at ${rules.passPercent}%`}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">{gradingKey(rules.bands)}</CardContent>
        </Card>
      </div>
    </>
  );
}

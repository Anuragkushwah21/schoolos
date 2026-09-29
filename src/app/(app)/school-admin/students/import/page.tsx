import type { Metadata, Route } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StudentImportForm } from "@/features/school/student-import-form";
import { requireTenant } from "@/server/auth/current-user";
import { STUDENT_IMPORT_COLUMNS } from "@/server/people/bulk-students";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportStudentsPage() {
  await requireTenant("SCHOOL_ADMIN");
  return (
    <>
      <PageHeader back={{ href: "/school-admin/students", label: "Students" }} title="Import students" />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>From a spreadsheet</CardTitle>
          <CardDescription>
            Students are placed in the current session. Every row is checked first; if any row has a problem, nothing is
            imported and each problem is listed by row. A guardian whose phone number the school already has is linked,
            not added twice.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={"/school-admin/students/import/template" as Route} prefetch={false}>
                <DownloadIcon className="size-4" aria-hidden />
                Download template
              </Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Columns: {STUDENT_IMPORT_COLUMNS.join(", ")}. Class and section must match the names used under Academics
            (e.g. &quot;Class 10&quot; and &quot;A&quot;). Admission no. may be left blank to number automatically. Dates as
            YYYY-MM-DD or DD/MM/YYYY.
          </p>
          <StudentImportForm />
        </CardContent>
      </Card>
    </>
  );
}

import type { Metadata, Route } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PreviewImportForm } from "@/features/imports/preview-import-form";
import { importTeachersAction } from "@/features/school/people-actions";
import { requireTenant } from "@/server/auth/current-user";
import { TEACHER_IMPORT_COLUMNS } from "@/server/people/teacher-import";

export const metadata: Metadata = { title: "Import teachers" };

export default async function ImportTeachersPage() {
  await requireTenant("SCHOOL_ADMIN");
  return (
    <>
      <PageHeader back={{ href: "/school-admin/teachers", label: "Teachers" }} title="Import teachers" />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>From a spreadsheet</CardTitle>
          <CardDescription>
            Each teacher gets a login with their email. &quot;Check file&quot; saves nothing; after the preview, import the
            valid rows and download their temporary passwords — they are shown only once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={"/school-admin/teachers/import/template" as Route} prefetch={false}>
                <DownloadIcon className="size-4" aria-hidden />
                Download template
              </Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Columns: {TEACHER_IMPORT_COLUMNS.join(", ")}. First name, last name and email are required. Employee ID may be
            left blank to number automatically. Up to 100 teachers per file.
          </p>
          <PreviewImportForm action={importTeachersAction} noun="teacher" />
        </CardContent>
      </Card>
    </>
  );
}

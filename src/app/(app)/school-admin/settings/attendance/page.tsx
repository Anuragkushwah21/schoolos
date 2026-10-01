import { ClipboardCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AttendanceSettingsForm } from "@/features/attendance/cover-forms";
import { attendanceSettings } from "@/server/attendance/cover";
import { requireTenant } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Attendance settings" };

export default async function AttendanceSettingsPage() {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const settings = await attendanceSettings(ctx);
  return (
    <>
      <PageHeader
        icon={ClipboardCheckIcon}
        tone="green"
        back={{ href: "/school-admin/settings", label: "Settings" }}
        title="Attendance settings"
        description="When class teachers take the daily attendance. Period times come from each class's timetable."
      />
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <AttendanceSettingsForm timing={settings.timing} submission={settings.submission} />
        </CardContent>
      </Card>
    </>
  );
}

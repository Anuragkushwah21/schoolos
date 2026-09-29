import { CalendarDaysIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WeeklyOffsForm } from "@/features/calendar/forms";
import { HolidaysScreen } from "@/features/calendar/holidays-screen";
import { param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { getWeeklyOffDays } from "@/server/calendar/holidays";

export const metadata: Metadata = { title: "Holidays" };

export default async function AdminHolidaysPage(props: PageProps<"/school-admin/holidays">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const weeklyOffDays = await getWeeklyOffDays(ctx);

  return (
    <>
      <PageHeader icon={CalendarDaysIcon} tone="amber"
        title="Calendar and holidays"
        description="Registers are closed on holidays, and holidays never count as absences. Teachers, students and parents see this calendar."
        actions={
          <Button asChild>
            <Link href="/school-admin/holidays/new">
              <PlusIcon aria-hidden />
              Add holiday
            </Link>
          </Button>
        }
      />
      <Card className="mb-6">
        <CardContent>
          <WeeklyOffsForm selected={weeklyOffDays} />
        </CardContent>
      </Card>
      <HolidaysScreen ctx={ctx} basePath="/school-admin/holidays" monthParam={param(search.month)} editable />
    </>
  );
}

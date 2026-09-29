import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { formatDateTime, formatDayShort, parseDateInput, today, toDateInput } from "@/lib/dates";
import type { TenantContext } from "@/server/auth/current-user";
import { getRegister } from "@/server/attendance/service";

import { StudentRegister } from "./register";

/**
 * The register screen shared by School Admins and teachers. The caller decides
 * which sections to offer; `getRegister` independently refuses any section the
 * user may not access, so a hand-edited `?section=` gets nowhere.
 */
export async function RegisterScreen({
  ctx,
  basePath,
  sections,
  sectionParam,
  dateParam,
}: {
  ctx: TenantContext;
  basePath: string;
  sections: Array<{ value: string; label: string }>;
  sectionParam?: string;
  dateParam?: string;
}) {
  if (!sections.length) {
    return (
      <EmptyState title="No classes to mark">
        {ctx.user.role === "TEACHER"
          ? "You are not assigned to any section this session. Ask the school office to assign your subjects."
          : "Create sections for the current session under Academics."}
      </EmptyState>
    );
  }

  const section = sections.find((s) => s.value === sectionParam) ?? sections[0]!;
  const date = parseDateInput(dateParam) ?? today();
  const register = await getRegister(ctx, section.value, date);

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        action={basePath}
        selects={[{ name: "section", label: "Section", defaultValue: section.value, options: sections }]}
        dates={[{ name: "date", label: "Date", defaultValue: toDateInput(date), max: toDateInput(today()) }]}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {register.section.label} · {formatDayShort(date)}
        </h2>
        <p className="text-muted-foreground text-sm">
          {register.lastMarked
            ? `Last saved ${formatDateTime(register.lastMarked.at)}${register.lastMarked.by ? ` by ${register.lastMarked.by}` : ""}`
            : "Not marked yet"}
        </p>
      </div>

      {register.closure?.kind === "WEEKLY_OFF" && register.editable ? (
        <p className="bg-muted/40 rounded-lg border px-3 py-2 text-sm">
          {register.closure.label} — attendance is not required. Record it only if the school held a special working day.
        </p>
      ) : null}

      {register.lockedReason ? (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-strong">
          {register.lockedReason}
        </p>
      ) : null}

      {register.rows.length ? (
        <StudentRegister
          sectionId={register.section.id}
          date={toDateInput(date)}
          editable={register.editable}
          rows={register.rows.map((row) => ({
            id: row.studentId,
            name: row.name,
            detail: [row.rollNumber ? `Roll ${row.rollNumber}` : null, row.admissionNumber].filter(Boolean).join(" · "),
            status: row.status,
            remarks: row.remarks,
          }))}
        />
      ) : (
        <EmptyState title="No students in this section" />
      )}
    </div>
  );
}

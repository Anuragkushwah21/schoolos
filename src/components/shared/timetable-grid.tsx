import type { DayOfWeek } from "@/generated/prisma/enums";
import { DAY_SHORT, WEEKDAYS, formatMinutes } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type GridSlot = {
  id: string;
  dayOfWeek: DayOfWeek;
  startMinute: number;
  endMinute: number;
  title: string;
  subtitle?: string;
  meta?: string | null;
};

/**
 * A week at a glance: days across, periods down. Rows are the distinct period
 * times actually in use, so a school with a 40-minute day and one with
 * 55-minute periods both render without empty filler rows.
 *
 * `actions` renders beside a slot (e.g. a delete button on the admin view);
 * `today` highlights the current day's column.
 */
export function TimetableGrid({
  slots,
  actions,
  today,
}: {
  slots: GridSlot[];
  actions?: Record<string, React.ReactNode>;
  today?: DayOfWeek;
}) {
  const days = WEEKDAYS.filter(
    (day) => day !== "SATURDAY" || slots.some((slot) => slot.dayOfWeek === "SATURDAY"),
  );

  const bands = [
    ...new Map(
      slots
        .map((slot) => [`${slot.startMinute}-${slot.endMinute}`, { start: slot.startMinute, end: slot.endMinute }] as const)
        .sort((a, b) => a[1].start - b[1].start || a[1].end - b[1].end),
    ).values(),
  ];

  if (!bands.length) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-10 text-center text-sm">
        No periods yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th scope="col" className="w-28 border-b px-3 py-2 text-left font-medium">
              Time
            </th>
            {days.map((day) => (
              <th
                key={day}
                scope="col"
                className={cn(
                  "border-b border-l px-3 py-2 text-left font-medium",
                  day === today && "bg-primary/10 text-primary",
                )}
              >
                {DAY_SHORT[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => (
            <tr key={`${band.start}-${band.end}`}>
              <th scope="row" className="text-muted-foreground border-b px-3 py-2 text-left align-top text-xs font-normal whitespace-nowrap">
                {formatMinutes(band.start)}
                <br />
                {formatMinutes(band.end)}
              </th>
              {days.map((day) => {
                const cell = slots.filter(
                  (slot) => slot.dayOfWeek === day && slot.startMinute === band.start && slot.endMinute === band.end,
                );
                return (
                  <td key={day} className={cn("border-b border-l p-1.5 align-top", day === today && "bg-primary/5")}>
                    {cell.map((slot) => (
                      <div key={slot.id} className="bg-card flex items-start justify-between gap-1 rounded-lg border px-2 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{slot.title}</p>
                          {slot.subtitle ? <p className="text-muted-foreground truncate text-xs">{slot.subtitle}</p> : null}
                          {slot.meta ? <p className="text-muted-foreground truncate text-xs">{slot.meta}</p> : null}
                        </div>
                        {actions?.[slot.id]}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

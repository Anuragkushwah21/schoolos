"use client";

import { cn } from "@/lib/utils";

/** One section's seats, as `seatOptionsFor` returns them. */
export type SectionSeats = {
  capacity: number | null;
  occupied: number;
  wholeStream: string | null;
  streams: Array<{ value: string; name: string; remaining: number; full: boolean }>;
};

/**
 * "Stream / Group" for a section that shares its seats among streams:
 * each stream with the seats it has left; a full one is shown and cannot be
 * chosen. The server checks the same again, under lock, whatever is posted.
 * Renders nothing for a section without streams.
 */
export function StreamSeatPicker({ seats, name = "streamId", defaultValue }: { seats: SectionSeats | undefined; name?: string; defaultValue?: string | null }) {
  if (!seats) return null;
  if (seats.wholeStream) {
    return (
      <p className="text-muted-foreground text-sm">
        Stream / Group: <span className="text-foreground font-medium">{seats.wholeStream}</span> (the whole section)
      </p>
    );
  }
  if (!seats.streams.length) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        Stream / Group <span className="text-danger">*</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {seats.streams.map((stream) => (
          <label
            key={stream.value}
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
              stream.full ? "bg-muted text-muted-foreground cursor-not-allowed" : "has-[:checked]:border-primary has-[:checked]:bg-primary-soft cursor-pointer",
            )}
          >
            <span className="flex items-center gap-2">
              <input type="radio" name={name} value={stream.value} disabled={stream.full} defaultChecked={defaultValue === stream.value && !stream.full} required className="accent-primary" />
              <span className="font-medium">{stream.name}</span>
            </span>
            <span className={cn("text-xs tabular-nums", stream.full ? "text-danger-strong font-semibold" : "text-muted-foreground")}>
              {stream.full ? "Full" : `${stream.remaining} seat${stream.remaining === 1 ? "" : "s"} available`}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

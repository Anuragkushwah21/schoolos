import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDayShort } from "@/lib/dates";

/** A person's own attendance record, newest first. */
export function AttendanceHistory({
  rows,
}: {
  rows: Array<{ date: Date; status: string; remarks: string | null }>;
}) {
  if (!rows.length) return <EmptyState title="No attendance marked yet" />;

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Remark</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.date.toISOString()}>
              <TableCell>{formatDayShort(row.date)}</TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">{row.remarks ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

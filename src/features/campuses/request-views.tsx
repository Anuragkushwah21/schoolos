import { StatusBadge } from "@/components/shared/status-badge";
import { formatDateTime } from "@/lib/dates";
import { moduleLabel } from "@/lib/school-modules";
import { cleanLimits, describeLimits, roleLabel } from "@/lib/school-roles";

import { REQUEST_STATUS } from "./status";

/** Request statuses as a badge, everywhere they appear. */
export function RequestStatusBadge({ status }: { status: string }) {
  const shown = REQUEST_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <StatusBadge status={status} label={shown.label} tone={shown.tone} />;
}

/** The short id people quote ("Request 2DP8ZWZJ"). */
export const requestRef = (id: string) => id.slice(-8).toUpperCase();

/** What was asked beside what was approved — the original request is never overwritten. */
export function RequestedVsApproved({ row }: { row: { status: string; requestedModules: string[]; requestedRoles: string[]; requestedLimits: unknown; approvedModules: string[]; approvedRoles: string[]; approvedLimits: unknown } }) {
  const decided = row.status === "APPROVED" || row.status === "MODIFIED";
  const list = (keys: string[], label: (key: string) => string) => keys.map(label).join(", ") || "core only";
  const rows = [
    { label: "Modules", asked: list(row.requestedModules, moduleLabel), approved: list(row.approvedModules, moduleLabel) },
    { label: "Roles", asked: list(row.requestedRoles, roleLabel), approved: list(row.approvedRoles, roleLabel) },
    { label: "Limits", asked: describeLimits(cleanLimits(row.requestedLimits)), approved: describeLimits(cleanLimits(row.approvedLimits)) },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="py-2 pr-4 font-medium" />
            <th className="py-2 pr-4 font-medium">Requested</th>
            <th className="py-2 font-medium">{decided ? "Approved by SchoolOS" : "Approved"}</th>
          </tr>
        </thead>
        <tbody className="divide-y align-top">
          {rows.map((item) => (
            <tr key={item.label}>
              <th className="py-2 pr-4 font-medium">{item.label}</th>
              <td className="py-2 pr-4">{item.asked}</td>
              <td className={decided && item.asked !== item.approved ? "text-warning-strong py-2 font-medium" : "py-2"}>{decided ? item.approved : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Who did what, and when, from the audit log. */
export function RequestHistory({ history }: { history: Array<{ id: string; summary: string; at: Date; by: string | null }> }) {
  if (!history.length) return <p className="text-muted-foreground text-sm">No history yet.</p>;
  return (
    <ol className="flex flex-col gap-3 border-l pl-4">
      {history.map((entry) => (
        <li key={entry.id} className="relative text-sm">
          <span className="bg-primary absolute top-1.5 -left-[21px] size-2.5 rounded-full" aria-hidden />
          <p>{entry.summary}</p>
          <p className="text-muted-foreground text-xs">{entry.by ? `${formatDateTime(entry.at)} · ${entry.by}` : formatDateTime(entry.at)}</p>
        </li>
      ))}
    </ol>
  );
}

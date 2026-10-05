import { STAFF_GRANTS, STAFF_MODULE_LABEL, STAFF_MODULES, type StaffAction, staffRoleMayHold } from "@/lib/staff-access";
import { cn } from "@/lib/utils";

const COLUMNS: StaffAction[] = ["VIEW", "CREATE", "EDIT", "DELETE", "MANAGE", "EXPORT"];
const COLUMN_LABEL: Record<StaffAction, string> = { VIEW: "View", CREATE: "Create", EDIT: "Edit", DELETE: "Delete", MANAGE: "Manage", EXPORT: "Export", PRINT: "Print" };

/**
 * Read-only summary: module × action, Yes / Limited / No — the table the
 * School Admin reads before editing. "Limited" means the server narrows what
 * comes back (a driver's students are only those on their route); "—" means
 * the module has no such action.
 */
export function PermissionMatrix({ grants, baseRole }: { grants: readonly string[]; baseRole: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Module</th>
            {COLUMNS.map((column) => (
              <th key={column} className="px-2 py-2 text-center font-medium">
                {COLUMN_LABEL[column]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAFF_MODULES.map((module) => {
            const defs = STAFF_GRANTS.filter((def) => def.module === module);
            return (
              <tr key={module} className="border-t">
                <td className="px-3 py-2 font-medium">{STAFF_MODULE_LABEL[module]}</td>
                {COLUMNS.map((column) => {
                  const forAction = defs.filter((def) => def.action === column);
                  if (!forAction.length) {
                    return (
                      <td key={column} className="text-muted-foreground px-2 py-2 text-center">
                        —
                      </td>
                    );
                  }
                  const held = forAction.filter((def) => grants.includes(def.key) && staffRoleMayHold(baseRole, def.key));
                  const limited = held.length > 0 && (held.length < forAction.length || held.some((def) => "scope" in def && def.scope));
                  const value = !held.length ? "No" : limited ? "Limited" : "Yes";
                  return (
                    <td key={column} className="px-2 py-2 text-center">
                      <span
                        title={forAction.map((def) => `${grants.includes(def.key) ? "✓" : "✗"} ${def.label}`).join("\n")}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          value === "Yes" && "bg-success-soft text-success-strong",
                          value === "Limited" && "bg-warning-soft text-warning-strong",
                          value === "No" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {value}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

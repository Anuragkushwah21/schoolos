"use client";

import { useState } from "react";

import { STAFF_GRANTS, STAFF_MODULE_LABEL, STAFF_MODULES, type StaffAction, type StaffModule, staffRoleMayHold } from "@/lib/staff-access";
import { cn } from "@/lib/utils";

const ACTION_LABEL: Record<StaffAction, string> = { VIEW: "View", CREATE: "Create", EDIT: "Edit", DELETE: "Delete", EXPORT: "Export", PRINT: "Print", MANAGE: "Manage" };
const ACTION_TONE: Record<StaffAction, string> = {
  VIEW: "bg-info-soft text-info-strong",
  CREATE: "bg-success-soft text-success-strong",
  EDIT: "bg-warning-soft text-warning-strong",
  DELETE: "bg-danger-soft text-danger-strong",
  EXPORT: "bg-purple-soft text-purple-strong",
  PRINT: "bg-purple-soft text-purple-strong",
  MANAGE: "bg-primary-soft text-primary-strong",
};

/**
 * Permissions as checkboxes, grouped by module, each with its action and
 * — where the server narrows it — "Limited". What the designation can never
 * hold is shown switched off with the reason, so the admin is not surprised
 * by the server refusing it. Submits `name` repeated, with an empty marker
 * so "nothing ticked" still arrives.
 *
 * `modulesFirst` puts the role's own modules at the top (a Librarian sees
 * Library first); the rest fold away under "Other modules".
 */
export function PermissionChecklist({
  name = "grants",
  baseRole,
  roleName,
  defaultValue,
  modulesFirst = [],
}: {
  name?: string;
  baseRole: string;
  roleName: string;
  defaultValue: readonly string[];
  modulesFirst?: readonly StaffModule[];
}) {
  const [selected, setSelected] = useState<string[]>(() => defaultValue.filter((key) => staffRoleMayHold(baseRole, key)));
  const toggle = (key: string, on: boolean) => setSelected((current) => (on ? [...current, key] : current.filter((item) => item !== key)));
  const first = STAFF_MODULES.filter((module) => modulesFirst.includes(module));
  const rest = STAFF_MODULES.filter((module) => !modulesFirst.includes(module));

  const group = (module: StaffModule) => {
    const defs = STAFF_GRANTS.filter((def) => def.module === module);
    const on = defs.filter((def) => selected.includes(def.key)).length;
    return (
      <fieldset key={module} className="rounded-xl border p-3">
        <legend className="px-1 text-sm font-semibold">
          {STAFF_MODULE_LABEL[module]} <span className="text-muted-foreground font-normal">· {on ? `${on} on` : "off"}</span>
        </legend>
        <ul className="flex flex-col gap-2">
          {defs.map((def) => {
            const allowed = staffRoleMayHold(baseRole, def.key);
            return (
              <li key={def.key}>
                <label className={cn("flex items-start gap-2 text-sm", !allowed && "opacity-60")}>
                  <input
                    type="checkbox"
                    name={name}
                    value={def.key}
                    disabled={!allowed}
                    checked={allowed && selected.includes(def.key)}
                    onChange={(event) => toggle(def.key, event.target.checked)}
                    className="accent-primary mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {def.label}
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", ACTION_TONE[def.action])}>{ACTION_LABEL[def.action]}</span>
                      {"scope" in def && def.scope ? <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">Limited</span> : null}
                    </span>
                    <span className="text-muted-foreground block text-xs">{allowed ? def.hint : `Never for a ${roleName.toLowerCase()}.`}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value="" />
      {first.map(group)}
      {rest.length ? (
        first.length ? (
          <details className="rounded-xl border border-dashed p-3">
            <summary className="cursor-pointer text-sm font-medium">Other modules</summary>
            <div className="mt-3 flex flex-col gap-3">{rest.map(group)}</div>
          </details>
        ) : (
          rest.map(group)
        )
      ) : null}
    </div>
  );
}

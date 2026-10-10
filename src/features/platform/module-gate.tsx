import Link from "next/link";
import { PackageXIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { type OptionalModule, moduleLabel } from "@/lib/school-modules";
import { requireUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db/prisma";
import { moduleStatus } from "@/server/platform/entitlements";

/**
 * Wraps a module's pages: a campus that has not switched the module on sees
 * why — not switched on here (the plan includes it), or not in the plan (and
 * which plans include it) — instead of the module. The services behind it
 * refuse as well; this only keeps the screen honest.
 */
export async function ModuleGate({ module, children }: { module: OptionalModule; children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.schoolId) return <>{children}</>;
  const status = await moduleStatus(user.schoolId, module);
  if (status.enabled) return <>{children}</>;
  const label = moduleLabel(module);
  const admin = user.role === "SCHOOL_ADMIN";
  if (status.reason === "NOT_ENABLED_FOR_CAMPUS") {
    return (
      <EmptyState icon={PackageXIcon} tone="neutral" title={`${label} is not switched on for this campus`}>
        {admin ? (
          <>
            {"Your plan includes it. "}
            <Link href="/school-admin/plan" className="text-primary font-medium underline">
              Switch it on in Plan &amp; billing
            </Link>
            .
          </>
        ) : (
          "Your school does not use this yet. Ask the school office if you think it should."
        )}
      </EmptyState>
    );
  }
  const plans = await prisma.plan.findMany({ where: { status: "PUBLISHED", isActive: true, optionalModules: { has: module } }, orderBy: { displayOrder: "asc" }, select: { name: true } });
  return (
    <EmptyState icon={PackageXIcon} tone="neutral" title={`${label} is not part of your school's plan`}>
      {admin ? (
        <>
          {plans.length ? `It comes with ${plans.map((plan) => plan.name).join(" and ")}. ` : "Contact SchoolOS about it. "}
          <Link href="/school-admin/plan" className="text-primary font-medium underline">
            Compare plans and request an upgrade
          </Link>
          . Everything else keeps working as before.
        </>
      ) : (
        "Your school does not use this. Ask the school office if you think it should."
      )}
    </EmptyState>
  );
}

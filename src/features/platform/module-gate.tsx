import { PackageXIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { type OptionalModule, moduleLabel } from "@/lib/school-modules";
import { requireUser } from "@/server/auth/current-user";
import { hasModule } from "@/server/platform/modules";

/**
 * Wraps a module's pages: a school whose plan does not include the module
 * sees a plain "not in your plan" page instead of the module. The services
 * behind it refuse as well — this only keeps the screen honest.
 */
export async function ModuleGate({ module, children }: { module: OptionalModule; children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.schoolId || (await hasModule({ schoolId: user.schoolId }, module))) return <>{children}</>;
  return (
    <EmptyState icon={PackageXIcon} tone="neutral" title={`${moduleLabel(module)} is not part of your school's plan`}>
      {user.role === "SCHOOL_ADMIN"
        ? "Contact SchoolOS to add it to your plan. Everything else keeps working as before."
        : "Your school does not use this. Ask the school office if you think it should."}
    </EmptyState>
  );
}

import { ModuleGate } from "@/features/platform/module-gate";

/** Finance pages open only for a school whose plan includes the module. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleGate module="FINANCE">{children}</ModuleGate>;
}

import { ModuleGate } from "@/features/platform/module-gate";

/** Fee receipts open only for a school whose plan includes fees. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleGate module="FINANCE">{children}</ModuleGate>;
}

import type { Route } from "next";
import Link from "next/link";
import { BanknoteIcon, FileBarChartIcon, ListPlusIcon, MonitorSmartphoneIcon, ReceiptIcon, WalletIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { rupees } from "@/features/finance/money";
import { cn } from "@/lib/utils";

export type AccountsDeskData = {
  collectedTodayMinor: number | null;
  receiptsToday: number | null;
  pendingMinor: number | null;
  spentThisMonthMinor: number | null;
  /** This month's payroll: people still to pay, and the amount due. */
  payroll: { unpaid: number; dueMinor: number } | null;
};

/**
 * The accountant's desk: the school's accounts at a glance and the work to do
 * — collect a fee, add an expense, record a purchase, pay salaries, reports.
 * Each part only with that responsibility; the services check it again. The
 * School Admin does all of the same from Finance, hired accountant or not.
 */
export function AccountsDesk({ data, can }: { data: AccountsDeskData; can: { collect: boolean; manage: boolean; expense: boolean; pay: boolean; reports: boolean } }) {
  const tiles = [
    data.collectedTodayMinor !== null ? { label: "Collected today", value: rupees(data.collectedTodayMinor), hint: `${data.receiptsToday ?? 0} receipt(s)` } : null,
    data.pendingMinor !== null ? { label: "Pending fees", value: rupees(data.pendingMinor), hint: "across the school" } : null,
    data.spentThisMonthMinor !== null ? { label: "Spent this month", value: rupees(data.spentThisMonthMinor), hint: "expenses & purchases" } : null,
    data.payroll ? { label: "Salaries to pay", value: String(data.payroll.unpaid), hint: data.payroll.unpaid ? `${rupees(data.payroll.dueMinor)} due this month` : "all paid this month", warn: data.payroll.unpaid > 0 } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; hint: string; warn?: boolean }>;
  const actions: Array<{ href: Route; label: string; icon: typeof WalletIcon; show: boolean }> = [
    { href: "/staff/fees", label: "Collect fee", icon: WalletIcon, show: can.collect },
    { href: "/staff/fees/structure", label: "Fee structure & charges", icon: ListPlusIcon, show: can.manage },
    { href: "/staff/expenses#add-expense" as Route, label: "Add expense", icon: ReceiptIcon, show: can.expense },
    { href: "/staff/expenses?category=EQUIPMENT#add-expense" as Route, label: "Buy equipment / gadget", icon: MonitorSmartphoneIcon, show: can.expense },
    { href: "/staff/payroll", label: "Pay salaries", icon: BanknoteIcon, show: can.pay },
    { href: "/staff/finance", label: "Accounts & reports", icon: FileBarChartIcon, show: true },
  ];
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Accounts desk</CardTitle>
        <CardDescription>The school&apos;s money: fee charges and collection, expenses and purchases out, salaries, and the reports.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className={cn("rounded-lg p-3", tile.warn ? "bg-warning-soft" : "bg-muted/50")}>
              <p className="text-muted-foreground text-xs">{tile.label}</p>
              <p className="text-lg font-semibold tabular-nums">{tile.value}</p>
              <p className="text-muted-foreground text-xs">{tile.hint}</p>
            </div>
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {actions
            .filter((action) => action.show)
            .map((action) => (
              <li key={action.label}>
                <Link href={action.href} className="bg-card hover:border-primary/50 hover:bg-primary-soft flex h-full items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors">
                  <action.icon className="text-primary size-4 shrink-0" aria-hidden />
                  {action.label}
                </Link>
              </li>
            ))}
        </ul>
      </CardContent>
    </Card>
  );
}

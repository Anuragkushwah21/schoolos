import { BoxesIcon, CheckCircle2Icon, CircleOffIcon, PackageIcon, PlusIcon, SearchXIcon, TagsIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";

import type { AccentTone } from "@/components/shared/tones";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/forms/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/forms/fields";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bulkAssetStatusAction, importAssetsAction } from "@/features/operations/actions";
import { AssetForm } from "@/features/operations/forms";
import { CsvImportForm } from "@/features/operations/import-form";
import { today, toDateInput } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { enumParam, param } from "@/lib/search-params";
import { ASSET_CATEGORIES, ASSET_STATUSES } from "@/lib/validation/operations";
import { requireTenant } from "@/server/auth/current-user";
import { assetLocations, assetSummary, listAssets } from "@/server/operations/inventory";

export const metadata: Metadata = { title: "Inventory" };

const STATUS_TONE = { ACTIVE: "positive", IN_REPAIR: "warning", DAMAGED: "negative", LOST: "negative", DISPOSED: "neutral" } as const;
const opts = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

/** Each status in its meaning's colour, with an icon so it reads without colour too. */
const STATUS_STYLE: Record<(typeof ASSET_STATUSES)[number], { tone: AccentTone; icon: typeof PackageIcon }> = {
  ACTIVE: { tone: "green", icon: CheckCircle2Icon },
  IN_REPAIR: { tone: "amber", icon: WrenchIcon },
  DAMAGED: { tone: "red", icon: TriangleAlertIcon },
  LOST: { tone: "red", icon: SearchXIcon },
  DISPOSED: { tone: "neutral", icon: CircleOffIcon },
};

export default async function InventoryPage(props: PageProps<"/school-admin/inventory">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const filters = {
    q: param(search.q),
    category: enumParam(search.category, ASSET_CATEGORIES),
    status: enumParam(search.status, ASSET_STATUSES),
    location: param(search.location),
  };
  const [assets, locations, summary] = await Promise.all([listAssets(ctx, filters), assetLocations(ctx), assetSummary(ctx)]);

  return (
    <>
      <PageHeader icon={PackageIcon} tone="orange"
        title="Inventory"
        description="Assets, where they are, who has them and their condition. Every change is kept in each asset's history."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/school-admin/reports/export?kind=assets" prefetch={false}>
                Export CSV
              </Link>
            </Button>
            <Button asChild>
              <a href="#add-asset">
                <PlusIcon aria-hidden />
                Add item
              </a>
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {ASSET_STATUSES.map((status) => (
          <StatCard
            key={status}
            tone={STATUS_STYLE[status].tone}
            icon={STATUS_STYLE[status].icon}
            label={humanize(status)}
            value={summary.byStatus[status] ?? 0}
            href={`/school-admin/inventory?status=${status}` as Route}
          />
        ))}
        <StatCard tone="blue" icon={TagsIcon} label="Categories" value={summary.byCategory.length} hint="in use" />
      </div>
      <FilterBar
        action="/school-admin/inventory"
        search={{ defaultValue: filters.q, placeholder: "Name, code or assigned to" }}
        selects={[
          { name: "category", label: "Category", defaultValue: filters.category, allLabel: "Any category", options: opts(ASSET_CATEGORIES) },
          { name: "status", label: "Status", defaultValue: filters.status, allLabel: "Any status", options: opts(ASSET_STATUSES) },
          { name: "location", label: "Location", defaultValue: filters.location, allLabel: "Anywhere", options: locations.map((value) => ({ value, label: value })) },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div>
          {assets.length ? (
            <ActionForm action={bulkAssetStatusAction}>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="px-3 py-2 font-medium">Asset</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 font-medium">Location / with</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => (
                      <tr key={asset.id} className="border-t">
                        <td className="px-3 py-2">
                          <input type="checkbox" name="assetIds" value={asset.id} aria-label={`Select ${asset.name}`} className="accent-primary size-4" />
                        </td>
                        <td className="px-3 py-2">
                          <Link href={`/school-admin/inventory/${asset.id}` as Route} className="font-medium hover:underline">
                            {asset.name}
                          </Link>
                          <span className="text-muted-foreground block text-xs">
                            {asset.code} · {humanize(asset.condition)}
                          </span>
                        </td>
                        <td className="px-3 py-2">{humanize(asset.category)}</td>
                        <td className="px-3 py-2">
                          {asset.location ?? "—"}
                          {asset.assignedTo ? <span className="text-muted-foreground block text-xs">{asset.assignedTo}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {/* One tracked item, or a stock of identical ones counted together. */}
                          <span className="inline-flex items-center gap-1.5">
                            {asset.quantity > 1 ? <BoxesIcon className="text-orange-strong size-3.5" aria-hidden /> : null}
                            {asset.quantity > 1 ? `Stock × ${asset.quantity}` : "Asset"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={asset.status} tone={STATUS_TONE[asset.status]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <SelectField name="status" label="Set selected to" options={opts(ASSET_STATUSES)} placeholder="Choose a status" className="w-48" />
                <TextField name="note" label="Note" className="min-w-48 flex-1" />
                <SubmitButton pendingLabel="Updating…">Update selected</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <EmptyState icon={PackageIcon} tone="orange" title={filters.q || filters.category || filters.status || filters.location ? "No items match these filters." : "No inventory items yet."}>
              Add laptops, furniture or lab equipment one by one, or a stock such as 50 packets of A4 paper with a quantity.
            </EmptyState>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle id="add-asset" className="scroll-mt-24">Add an item</CardTitle>
            </CardHeader>
            <CardContent>
              <AssetForm today={toDateInput(today())} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Import from CSV</CardTitle>
              <CardDescription>
                <Link href="/school-admin/reports/export?kind=template-assets" prefetch={false} className="underline">
                  Template
                </Link>
                . Codes must be new; nothing is saved unless every row is valid.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CsvImportForm action={importAssetsAction} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

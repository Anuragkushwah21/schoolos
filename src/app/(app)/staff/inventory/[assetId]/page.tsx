import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetForm } from "@/features/operations/forms";
import { formatDateTime, today, toDateInput } from "@/lib/dates";
import { fullName, humanize } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { requireStaffModule, staffHolds } from "@/server/auth/staff-access";
import { getAsset } from "@/server/operations/inventory";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Asset" };

/** One item for staff: its history, and the edit form only with "Manage inventory". */
export default async function StaffAssetPage(props: PageProps<"/staff/inventory/[assetId]">) {
  const ctx = await requireTenant("NON_TEACHING_STAFF");
  await requireStaffModule(ctx, "inventory.view");
  const canManage = await staffHolds(ctx, "inventory.manage");
  const { assetId } = await props.params;
  const asset = await orNotFound(getAsset(ctx, assetId));
  return (
    <>
      <PageHeader back={{ href: "/staff/inventory", label: "Inventory" }} title={`${asset.name} · ${asset.code}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            {canManage ? (
            <AssetForm
              today={toDateInput(today())}
              asset={{
                ...asset,
                purchaseDate: asset.purchaseDate ? toDateInput(asset.purchaseDate) : "",
                purchaseCost: asset.purchaseCostMinor === null ? "" : (asset.purchaseCostMinor / 100).toFixed(2),
              }}
            />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{humanize(asset.category)}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd>{asset.location ?? "—"}</dd>
                <dt className="text-muted-foreground">With</dt>
                <dd>{asset.assignedTo ?? "—"}</dd>
                <dt className="text-muted-foreground">Condition</dt>
                <dd>{humanize(asset.condition)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{humanize(asset.status)}</dd>
              </dl>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {asset.events.map((event) => (
                <li key={event.id} className="py-2">
                  {event.summary}
                  <span className="text-muted-foreground block text-xs">
                    {formatDateTime(event.createdAt)}
                    {event.actor ? ` · ${fullName(event.actor)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

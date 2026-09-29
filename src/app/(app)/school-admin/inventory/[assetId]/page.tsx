import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssetForm } from "@/features/operations/forms";
import { formatDateTime, today, toDateInput } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { requireTenant } from "@/server/auth/current-user";
import { getAsset } from "@/server/operations/inventory";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Asset" };

export default async function AssetPage(props: PageProps<"/school-admin/inventory/[assetId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { assetId } = await props.params;
  const asset = await orNotFound(getAsset(ctx, assetId));
  return (
    <>
      <PageHeader back={{ href: "/school-admin/inventory", label: "Inventory" }} title={`${asset.name} · ${asset.code}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <AssetForm
              today={toDateInput(today())}
              asset={{
                ...asset,
                purchaseDate: asset.purchaseDate ? toDateInput(asset.purchaseDate) : "",
                purchaseCost: asset.purchaseCostMinor === null ? "" : (asset.purchaseCostMinor / 100).toFixed(2),
              }}
            />
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

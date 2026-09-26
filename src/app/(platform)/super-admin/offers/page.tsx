import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteOfferAction } from "@/features/platform/actions";
import { formatDate } from "@/lib/dates";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listOffers } from "@/server/platform/offers";

export const metadata: Metadata = { title: "Offers" };

function offerState(offer: { isActive: boolean; startsAt: Date; endsAt: Date | null }, now: Date) {
  if (!offer.isActive) return { status: "INACTIVE", label: "Off" };
  if (offer.startsAt > now) return { status: "PENDING", label: "Scheduled" };
  if (offer.endsAt && offer.endsAt < now) return { status: "EXPIRED", label: "Expired" };
  return { status: "ACTIVE", label: "Showing" };
}

export default async function OffersPage() {
  const user = await requireSuperAdmin();
  const offers = await listOffers(user);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Offers"
        description="Promotions on the homepage. They show only between their dates."
        actions={
          <Button asChild>
            <Link href="/super-admin/offers/new">New offer</Link>
          </Button>
        }
      />

      {offers.length ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Offer</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offers.map((offer) => {
                const state = offerState(offer, now);
                return (
                  <TableRow key={offer.id}>
                    <TableCell>
                      <Link href={`/super-admin/offers/${offer.id}`} className="font-medium hover:underline">
                        {offer.title}
                      </Link>
                      {offer.priceLabel ? (
                        <p className="text-muted-foreground text-xs">{offer.priceLabel}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={state.status} label={state.label} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(offer.startsAt)} – {offer.endsAt ? formatDate(offer.endsAt) : "open-ended"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/super-admin/offers/${offer.id}`}>Edit</Link>
                        </Button>
                        <ActionButton
                          action={deleteOfferAction}
                          fields={{ offerId: offer.id }}
                          variant="destructive"
                          confirm={{
                            title: `Delete "${offer.title}"?`,
                            description: "It disappears from the homepage immediately. This cannot be undone.",
                            confirmLabel: "Delete",
                          }}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No offers yet" />
      )}
    </>
  );
}

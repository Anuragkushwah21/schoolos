import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { revokeApiTokenAction } from "@/features/tokens/actions";
import { CreateTokenForm } from "@/features/tokens/token-form";
import { formatDate, formatDateTime } from "@/lib/dates";
import { requireRole } from "@/server/auth/current-user";
import { listApiTokens } from "@/server/auth/api-token";

export const metadata: Metadata = { title: "API tokens" };

export default async function ApiTokensPage() {
  const user = await requireRole("SCHOOL_ADMIN", "SUPER_ADMIN");
  const tokens = await listApiTokens(user);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="API tokens"
        description={
          user.role === "SUPER_ADMIN"
            ? "Tokens for the platform API. Each one acts as you."
            : "Tokens for this school's data. Each one acts as the person who created it."
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Your tokens</CardTitle>
            <CardDescription>
              A token can never do more than the person who created it, and stops
              working the moment their account is disabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tokens.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Token</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.map((token) => {
                    const expired = token.expiresAt && token.expiresAt < now;
                    return (
                      <TableRow key={token.id}>
                        <TableCell>
                          <p className="font-medium">{token.name}</p>
                          <p className="text-muted-foreground font-mono text-xs">{token.prefix}…</p>
                          <p className="text-muted-foreground text-xs">
                            {token.user.firstName} {token.user.lastName} · created{" "}
                            {formatDate(token.createdAt)}
                            {token.expiresAt ? ` · expires ${formatDate(token.expiresAt)}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={token.scope === "FULL" ? "ACTIVE" : "INFO"}
                            tone={token.scope === "FULL" ? "warning" : "info"}
                            label={token.scope === "FULL" ? "Read & write" : "Read only"}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "Never"}
                        </TableCell>
                        <TableCell className="text-right">
                          {token.revokedAt ? (
                            <StatusBadge status="INACTIVE" label="Revoked" />
                          ) : expired ? (
                            <StatusBadge status="EXPIRED" label="Expired" />
                          ) : (
                            <ActionButton
                              action={revokeApiTokenAction}
                              fields={{ tokenId: token.id }}
                              variant="destructive"
                              confirm={{
                                title: `Revoke "${token.name}"?`,
                                description:
                                  "Anything using this token stops working on its next request. This cannot be undone.",
                                confirmLabel: "Revoke",
                              }}
                            >
                              Revoke
                            </ActionButton>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="No tokens yet">
                Create one to call the API from a script, a mobile app or another system.
              </EmptyState>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>New token</CardTitle>
              <CardDescription>The token is shown once, when it is created.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateTokenForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Using it</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">Send it as a bearer token:</p>
              <pre className="bg-muted overflow-x-auto rounded-lg p-3 font-mono text-xs">
                {`curl ${process.env.APP_URL ?? "https://schoolos.app"}/api/v1/me \\\n  -H "Authorization: Bearer sos_…"`}
              </pre>
              <p className="text-muted-foreground">
                The full endpoint list is at <code className="font-mono">/api/v1</code>.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

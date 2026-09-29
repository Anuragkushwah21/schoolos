import { HeartHandshakeIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pager } from "@/components/shared/pager";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ParentDetailsDialog } from "@/features/school/parent-dialog";
import { humanize, pluralize } from "@/lib/format";
import { pageParam, param } from "@/lib/search-params";
import { requireTenant } from "@/server/auth/current-user";
import { listParents } from "@/server/people/parents";

export const metadata: Metadata = { title: "Parents" };

/**
 * Families, rather than students with a parent attached.
 *
 * The list a school needs when a parent rings up, and the one that makes a
 * multi-child family obvious: one row, three children. Searchable by the
 * parent's own details *and* by their children's, because the office is usually
 * given whichever name the caller happens to mention.
 */
export default async function ParentsPage(props: PageProps<"/school-admin/parents">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const search = await props.searchParams;
  const q = param(search.q);
  // Families with a current child by default; those whose children have all
  // left stay one filter away rather than cluttering the list.
  const standingParam = param(search.standing);
  const standing = standingParam === "ALL" ? undefined : standingParam === "NO_ACTIVE_CHILDREN" ? "NO_ACTIVE_CHILDREN" : "ACTIVE";

  const { rows, total, page, pageCount } = await listParents(ctx, { q, standing, page: pageParam(search.page) });

  const multiChild = rows.filter((row) => row.childCount > 1).length;
  const withLogin = rows.filter((row) => row.hasLogin).length;

  return (
    <>
      <PageHeader icon={HeartHandshakeIcon} tone="blue"
        title="Parents"
        description="One account per family. Link a sibling to the existing parent rather than adding a second."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Parents" value={total} hint="on this page's filter" />
        <StatCard label="With more than one child" value={multiChild} />
        <StatCard label="With a portal login" value={withLogin} />
      </div>

      <FilterBar
        action="/school-admin/parents"
        search={{
          defaultValue: q,
          placeholder: "Parent name, mobile, email — or a child's name or admission no",
        }}
        selects={[
          {
            name: "standing",
            label: "Standing",
            defaultValue: standingParam ?? "ACTIVE",
            options: [
              { value: "ACTIVE", label: "With a current child" },
              { value: "NO_ACTIVE_CHILDREN", label: "No active children" },
              { value: "ALL", label: "All families" },
            ],
          },
        ]}
      />

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parent</TableHead>
                <TableHead className="w-36">Mobile</TableHead>
                <TableHead className="hidden lg:table-cell">Email</TableHead>
                <TableHead className="w-20 text-right">Children</TableHead>
                <TableHead>Their children</TableHead>
                <TableHead className="w-32">Login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((parent) => (
                <TableRow key={parent.id}>
                  <TableCell>
                    {/* The name opens the family in a dialog: the fastest answer
                        to "how many children does this parent have here?" */}
                    <ParentDetailsDialog parent={parent} />
                    <Link href={`/school-admin/parents/${parent.id}` as Route} className="text-muted-foreground block text-xs hover:underline">
                      Profile, status &amp; login
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{parent.phone}</TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell">
                    {parent.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{parent.childCount}</TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    {parent.children.length ? (
                      <ul className="flex flex-col gap-0.5">
                        {parent.children.map((child) => (
                          <li key={child.id} className="flex flex-wrap items-center gap-1 text-xs">
                            <span className="font-medium">{child.name}</span>
                            {child.status !== "ACTIVE" ? <StatusBadge status={child.status} /> : null}
                            <span className="text-muted-foreground">
                              {child.sectionLabel ? ` — ${child.sectionLabel}` : ""} ·{" "}
                              {humanize(child.relationship)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground text-xs">None linked</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={parent.login} />
                      {parent.standing !== "ACTIVE" ? <StatusBadge status={parent.standing} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title={q ? "No parent matches that" : "No parents yet"}>
          A parent is created with their first child. Admitting a sibling afterwards should link the
          same parent rather than adding another.
        </EmptyState>
      )}

      <Pager
        page={page}
        pageCount={pageCount}
        total={total}
        basePath="/school-admin/parents"
        params={{ q, standing: standingParam }}
      />
      <p className="text-muted-foreground mt-2 text-xs">
        {pluralize(total, "family", "families")} matched.
      </p>
    </>
  );
}

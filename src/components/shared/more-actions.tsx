"use client";

import type { Route } from "next";
import Link from "next/link";
import { MoreHorizontalIcon } from "lucide-react";

import { useT } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The secondary things a page can do, folded behind one "More" button so the
 * page's primary action is the only one competing for attention.
 */
export function MoreActions({ items }: { items: Array<{ href: Route | string; label: string; download?: boolean }> }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <MoreHorizontalIcon aria-hidden />
          {t("common.more")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            {item.download ? (
              // Exports are file downloads, not pages: a plain link avoids prefetching them.
              <a href={item.href}>{item.label}</a>
            ) : (
              <Link href={item.href as Route}>{item.label}</Link>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

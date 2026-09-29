"use client";

import type { Route } from "next";
import Link from "next/link";
import { useTransition } from "react";
import { ChevronDownIcon, CircleUserIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";

import { useT } from "@/components/i18n/i18n-provider";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserRole } from "@/generated/prisma/enums";

import { logoutAction } from "./actions";

/**
 * The signed-in person's corner of the header: who they are, their profile,
 * their password, and signing out. The links are computed server-side from the
 * role; this component never derives a route itself.
 */
export function UserMenu({ name, email, role, profileHref }: { name: string; email: string; role: UserRole; profileHref: Route }) {
  const t = useT();
  const [signingOut, startSignOut] = useTransition();
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label={`${name}, ${t(`role.${role}`)}`}>
          <span className="bg-primary-soft text-primary-strong flex size-8 items-center justify-center rounded-full text-xs font-semibold" aria-hidden>
            {initials || "?"}
          </span>
          <span className="hidden max-w-40 flex-col items-start leading-tight lg:flex">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="text-muted-foreground text-xs">{t(`role.${role}`)}</span>
          </span>
          <ChevronDownIcon className="size-4 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">{email}</span>
          <span className="text-muted-foreground text-xs font-normal">{t(`role.${role}`)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={profileHref}>
            <CircleUserIcon aria-hidden />
            {t("common.myProfile")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account">
            <KeyRoundIcon aria-hidden />
            {t("common.account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            startSignOut(() => void logoutAction());
          }}
        >
          {signingOut ? <Spinner size="xs" /> : <LogOutIcon aria-hidden />}
          {signingOut ? t("common.signingOut") : t("common.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

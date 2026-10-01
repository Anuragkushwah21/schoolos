"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TONE_ICON, toneFor } from "@/components/shared/tones";
import { cn } from "@/lib/utils";

/** "Anurag Kushwah" → "AK". */
export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

/**
 * A person's photo, or their initials when there is none — or when the photo
 * cannot be loaded (never a broken-image icon). Initials get a colour from
 * the name, so the same person always looks the same in every list.
 */
export function PersonAvatar({ name, photoUrl, className, fallbackClassName }: { name: string; photoUrl?: string | null; className?: string; fallbackClassName?: string }) {
  return (
    <Avatar className={cn("size-8", className)}>
      {photoUrl ? <AvatarImage src={photoUrl} alt="" className="object-cover" /> : null}
      <AvatarFallback className={cn(TONE_ICON[toneFor(name)], "text-xs font-semibold", fallbackClassName)}>{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}

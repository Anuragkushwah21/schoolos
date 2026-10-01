import { PersonAvatar } from "@/components/shared/person-avatar";

/**
 * A person's photo on someone else's page — view only. Only the person
 * changes their own photo, from their profile.
 */
export function PersonPhoto({ name, photoUrl, who = "They" }: { name: string; photoUrl: string | null; who?: string }) {
  return (
    <div className="flex items-center gap-4">
      <PersonAvatar name={name} photoUrl={photoUrl} className="size-20" fallbackClassName="text-lg" />
      <p className="text-muted-foreground max-w-xs text-xs">
        {photoUrl ? "Profile photo." : "No photo yet."} {who} can add or change it from their own profile.
      </p>
    </div>
  );
}

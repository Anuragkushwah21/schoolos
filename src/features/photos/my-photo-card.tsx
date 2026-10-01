import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PhotoUploader } from "@/features/photos/photo-uploader";
import type { TenantContext } from "@/server/auth/current-user";
import { photoUrlFor, selfTarget } from "@/server/people/photos";

/** "Profile photo" on a person's own profile page: upload, replace or remove. */
export async function MyPhotoCard({ ctx, name, className }: { ctx: TenantContext; name: string; className?: string }) {
  const target = await selfTarget(ctx).catch(() => null);
  if (!target) return null;
  const url = await photoUrlFor(ctx, target);
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Profile photo</CardTitle>
        <CardDescription>JPG, PNG or WebP, up to 2 MB. It shows next to your name across SchoolOS.</CardDescription>
      </CardHeader>
      <CardContent>
        <PhotoUploader owner="SELF" name={name} url={url} />
      </CardContent>
    </Card>
  );
}

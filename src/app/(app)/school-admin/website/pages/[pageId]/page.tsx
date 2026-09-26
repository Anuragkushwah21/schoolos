import type { Metadata } from "next";

import { ActionButton } from "@/components/forms/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { deletePageAction } from "@/features/website/actions";
import { PageForm } from "@/features/website/forms";
import { requireTenant } from "@/server/auth/current-user";
import { getPage } from "@/server/website/admin";
import { orNotFound } from "@/server/page-helpers";

export const metadata: Metadata = { title: "Edit page" };

export default async function EditWebsitePage(props: PageProps<"/admin/website/pages/[pageId]">) {
  const ctx = await requireTenant("SCHOOL_ADMIN");
  const { pageId } = await props.params;
  const page = await orNotFound(getPage(ctx, pageId));

  return (
    <>
      <PageHeader
        back={{ href: "/admin/website", label: "Website" }}
        title={page.title}
        description={`/schools/${ctx.schoolSlug}/${page.slug}`}
        actions={
          <ActionButton
            action={deletePageAction}
            fields={{ pageId: page.id }}
            variant="destructive"
            confirm={{
              title: "Delete this page?",
              description: "It disappears from your website immediately. This cannot be undone.",
              confirmLabel: "Delete",
            }}
          >
            Delete
          </ActionButton>
        }
      />
      <PageForm
        page={{
          id: page.id,
          title: page.title,
          slug: page.slug,
          body: page.body,
          sortOrder: page.sortOrder,
          isPublished: page.isPublished,
        }}
      />
    </>
  );
}

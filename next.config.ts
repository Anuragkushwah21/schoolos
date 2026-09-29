import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Type-check every internal link against the real route tree.
   *
   * Without this, a `Link href` is just a string: renaming a route leaves
   * silent 404s that no check catches. With it, `next typegen` generates a
   * union of the app's actual routes and `tsc` fails on a link to one that
   * does not exist — which is what makes moving a route a mechanical change
   * rather than a hunt through greps.
   */
  typedRoutes: true,

  /**
   * The slot-booking PTM screens were replaced by Meetings, which covers PTMs
   * too. Old bookmarks land on the new list rather than a 404.
   */
  async redirects() {
    return [
      { source: "/school-admin/ptm/:path*", destination: "/school-admin/meetings", permanent: false },
      { source: "/teacher/ptm", destination: "/teacher/meetings", permanent: false },
      { source: "/parent/ptm", destination: "/parent/meetings", permanent: false },
    ];
  },

  experimental: {
    serverActions: {
      /**
       * Lesson PDFs are uploaded through a Server Action. The service caps a
       * file at 10 MB (`MAX_DOCUMENT_BYTES`); this leaves room for the multipart
       * overhead and the other form fields, and nothing more.
       */
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;

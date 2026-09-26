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
};

export default nextConfig;

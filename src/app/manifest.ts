import type { MetadataRoute } from "next";

/**
 * Lets the app be installed from the browser ("Add to Home screen"), so a
 * parent or staff member opens it from an icon like any other app on their
 * phone, full-screen, straight to their own home page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SchoolOS",
    short_name: "SchoolOS",
    description: "Your school on your phone: attendance, homework, results, fees and notices.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f6fb",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

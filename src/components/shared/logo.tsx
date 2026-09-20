import { cn } from "@/lib/utils";

/** The SchoolOS wordmark: a book-and-grid glyph beside the name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg
        viewBox="0 0 24 24"
        className="text-primary size-6"
        aria-hidden
        fill="none"
      >
        <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" />
        <path
          d="M7 8.5c1.8-.9 3.5-.9 5 0 1.5-.9 3.2-.9 5 0v7.5c-1.8-.9-3.5-.9-5 0-1.5-.9-3.2-.9-5 0V8.5Z"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M12 8.5V16" stroke="white" strokeWidth="1.5" />
      </svg>
      <span>SchoolOS</span>
    </span>
  );
}

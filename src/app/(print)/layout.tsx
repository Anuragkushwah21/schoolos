/**
 * Printable documents — fee receipts and report cards — are paper, so they
 * stay light whatever theme the person uses on screen (`.force-light` restores
 * the light design tokens for this subtree).
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="force-light flex min-h-full flex-1 flex-col">{children}</div>;
}

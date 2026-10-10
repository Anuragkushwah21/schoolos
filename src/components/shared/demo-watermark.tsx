/**
 * Printed across every receipt and report card from the Live Demo, so a
 * sample can never be mistaken for a real document.
 */
export function DemoWatermark({ what }: { what: string }) {
  return (
    <>
      <p role="note" className="mx-auto mb-4 max-w-3xl rounded border-2 border-dashed border-red-500 bg-red-50 px-4 py-2 text-center text-sm font-bold tracking-wide text-red-700 uppercase">
        {`Demo school — sample ${what} with fictional data. Not valid for any purpose.`}
      </p>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden print:fixed">
        <span className="rotate-[-30deg] text-[12vw] font-black tracking-widest text-red-500/10 select-none">SAMPLE</span>
      </div>
    </>
  );
}

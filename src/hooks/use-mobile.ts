import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Subscribe to the viewport width via `useSyncExternalStore`.
 *
 * `matchMedia` is an external store, so reading it through an effect +
 * `setState` causes a cascading render on mount (and trips the React Compiler
 * lint rule). `useSyncExternalStore` reads the current value during render and
 * re-renders only when the media query actually changes.
 *
 * The server snapshot is `false`: there is no viewport while prerendering, so
 * the desktop layout is the safe default and hydration corrects it if needed.
 */
function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(MEDIA_QUERY)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

function getSnapshot() {
  return window.matchMedia(MEDIA_QUERY).matches
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

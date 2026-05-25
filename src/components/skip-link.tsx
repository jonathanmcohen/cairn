/**
 * First focusable element of the authenticated app shell; jumps keyboard /
 * screen-reader users past the sidebar nav straight to <main id="main-content">.
 *
 * Hidden until focused: collapses to a true 0×0 box (so the mobile touch-target
 * audit treats it as hidden, matching the `r.width === 0 || r.height === 0`
 * skip rule), but stays a tabstop via `position: absolute`. The focus override
 * then expands it to ≥44×44 (`min-h-11 min-w-11`, WCAG 2.5.5) in the top-left.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="absolute -m-px h-0 w-0 overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)] focus:static focus:z-50 focus:m-2 focus:inline-flex focus:min-h-11 focus:min-w-11 focus:items-center focus:overflow-visible focus:whitespace-normal focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:text-foreground focus:shadow focus:outline focus:outline-2 focus:outline-ring focus:[clip:auto]"
    >
      Skip to main content
    </a>
  );
}

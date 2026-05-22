/**
 * First focusable element of the authenticated app shell; jumps keyboard /
 * screen-reader users past the sidebar nav straight to <main id="main-content">.
 *
 * Hidden until focused: uses the same sr-only class string as VisuallyHidden,
 * then a focus override that places it visibly in the top-left corner.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)] focus:static focus:z-50 focus:m-2 focus:h-auto focus:w-auto focus:overflow-visible focus:whitespace-normal focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:text-foreground focus:shadow focus:outline focus:outline-2 focus:outline-ring focus:[clip:auto]"
    >
      Skip to main content
    </a>
  );
}

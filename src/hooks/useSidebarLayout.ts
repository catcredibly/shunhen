import { useEffect, useState } from "react";

/** Widths are WebView CSS pixels, already adjusted for desktop display scaling. */
export function useSidebarLayout() {
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Keep the full content width at the existing Analytics/History minimum window size.
  const hidden = viewportWidth <= 1040;
  const collapsed = manualCollapsed ?? viewportWidth <= 1360;
  return { hidden, collapsed, toggle: () => setManualCollapsed(!collapsed) };
}

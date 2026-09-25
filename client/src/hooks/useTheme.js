import { useCallback, useEffect, useState } from "react";

const KEY = "aurelia_theme";

const current = () => document.documentElement.getAttribute("data-theme") || "dark";

/** Dark / light theme, remembered per browser. index.html applies it before paint. */
export default function useTheme() {
  const [theme, setTheme] = useState(current);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#F6F4FF" : "#07061A");
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* private mode: theme just won't persist */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);
  return { theme, toggle };
}

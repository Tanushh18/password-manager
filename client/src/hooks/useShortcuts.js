import { useEffect, useRef } from "react";

const typing = (el) =>
  el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * Page keyboard shortcuts: "/" focuses the search box, "n" runs `onNew`.
 * Ignored while typing in a field, with a modifier key held, or while a
 * modal is open. Returns the ref to put on the search input.
 */
export default function useShortcuts(onNew) {
  const searchRef = useRef(null);
  const newRef = useRef(onNew);
  newRef.current = onNew;

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(document.activeElement)) return;
      if (document.querySelector(".react-responsive-modal-root")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if ((e.key === "n" || e.key === "N") && !e.shiftKey && newRef.current) {
        e.preventDefault();
        newRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return searchRef;
}

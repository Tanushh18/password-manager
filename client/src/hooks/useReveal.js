import { useEffect } from "react";

/** Reads a scroll-driven parallax offset for gentle depth. */
export function useParallax(ref, strength = 0.12) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    let frame = null;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        el.style.transform = `translate3d(0, ${window.scrollY * strength}px, 0)`;
        frame = null;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, strength]);
}

export default useParallax;

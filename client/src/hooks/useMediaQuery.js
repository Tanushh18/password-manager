import { useEffect, useState } from "react";

const match = (query) => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;

/** True while the media query matches; follows resizes and rotation. */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => match(query));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, [query]);
  return matches;
}

/* Shared breakpoints (keep in step with styles/system.css). */
export const PHONE = "(max-width: 759px)";
export const TABLET = "(min-width: 760px) and (max-width: 1099px)";

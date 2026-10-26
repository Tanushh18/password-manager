import React from "react";

/* Line icons for the vault sidebar and cards. 24px grid, 1.6 stroke, currentColor. */
const Svg = ({ size = 18, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
    {children}
  </svg>
);

export const IcOverview = (p) => <Svg {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><path d="M13.5 17h7M17 13.5v7" /></Svg>;
export const IcKey = (p) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></Svg>;
export const IcStar = (p) => <Svg {...p}><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" /></Svg>;
export const IcNote = (p) => <Svg {...p}><path d="M6 3.5h8.5L19 8v12.5H6z" /><path d="M14 3.5V8h5M9 12.5h6.5M9 16h4.5" /></Svg>;
export const IcCard = (p) => <Svg {...p}><rect x="2.8" y="5.5" width="18.4" height="13" rx="2.2" /><path d="M2.8 9.6h18.4M6.5 15h3.5" /></Svg>;
export const IcIdentity = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2.2" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h3.5M14.5 13.5h3" /></Svg>;
export const IcFolder = (p) => <Svg {...p}><path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.2h7.6c1 0 1.7.8 1.7 1.7v8.4c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7z" /></Svg>;
export const IcTrash = (p) => <Svg {...p}><path d="M4.5 7h15M10 3.8h4M6.5 7l.9 12.2c.1.9.8 1.5 1.7 1.5h5.8c.9 0 1.6-.6 1.7-1.5L17.5 7M10 11v6M14 11v6" /></Svg>;
export const IcWand = (p) => <Svg {...p}><path d="M4 20L15 9M13 7l4 4" /><path d="M18 3v3M16.5 4.5h3M20 10v2M19 11h2M9 3.5v2M8 4.5h2" /></Svg>;
export const IcShield = (p) => <Svg {...p}><path d="M12 3.2l7 2.8v5.4c0 4.6-3 8.1-7 9.4-4-1.3-7-4.8-7-9.4V6z" /><path d="M9 12l2.2 2.2L15.2 10" /></Svg>;
export const IcGear = (p) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" /></Svg>;
export const IcMore = (p) => <Svg {...p}><circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" /></Svg>;
export const IcUser = (p) => <Svg {...p}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4" /></Svg>;
export const IcGlobe = (p) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z" /></Svg>;
export const IcPlane = (p) => <Svg {...p}><path d="M2.8 13.5l7.4-1.6L14.6 4c.5-.9 1.8-.6 1.8.4l-.8 6.6 4.5-1c.8-.2 1.5.6 1.1 1.4l-.6 1.1-16.9 3.6z" /><path d="M3 19.5h18" /></Svg>;

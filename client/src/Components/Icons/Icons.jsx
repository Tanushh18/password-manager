import React from "react";

/* Elegant line-art icon set — thin strokes, rounded caps, inherits currentColor */

const base = (size, extra = {}) => ({
  width: size,
  height: size,
  display: "block",
  flexShrink: 0,
  ...extra,
});

export const HeartLine = ({ size = 24, strokeWidth = 1.3, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M12 20.5s-7.4-4.6-9.2-9A5 5 0 0 1 12 6.6a5 5 0 0 1 9.2 4.9c-1.8 4.4-9.2 9-9.2 9z" />
  </svg>
);

export const Sparkle = ({ size = 16, strokeWidth = 1.2, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M12 3c.6 4.2 1.8 5.4 6 6-4.2.6-5.4 1.8-6 6-.6-4.2-1.8-5.4-6-6 4.2-.6 5.4-1.8 6-6z" />
  </svg>
);

export const LockLine = ({ size = 24, strokeWidth = 1.3, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <rect x="4" y="10.5" width="16" height="10" rx="3" />
    <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    <path d="M12 14.6v2.2" />
  </svg>
);

export const KeyLine = ({ size = 24, strokeWidth = 1.3, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <circle cx="8" cy="8" r="4.2" />
    <path d="M11 11l8 8M16.5 16.5l2-2M14 14l1.6-1.6" />
  </svg>
);

export const ShieldLine = ({ size = 24, strokeWidth = 1.3, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M12 3l7 3v5.6c0 4.2-2.9 7.8-7 9.4-4.1-1.6-7-5.2-7-9.4V6z" />
    <path d="M9.2 12.2l2 2 3.6-3.8" />
  </svg>
);

export const Eye = ({ size = 18, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M1.8 12S5.6 5.2 12 5.2 22.2 12 22.2 12 18.4 18.8 12 18.8 1.8 12 1.8 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOff = ({ size = 18, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M17.9 17.9A10 10 0 0 1 12 19.8c-6.4 0-10.2-7.8-10.2-7.8a18.4 18.4 0 0 1 5-5.9" />
    <path d="M9.9 4.5A9.1 9.1 0 0 1 12 4.2c6.4 0 10.2 7.8 10.2 7.8a18.5 18.5 0 0 1-2.2 3.2" />
    <path d="M2 2l20 20" />
  </svg>
);

export const Trash = ({ size = 16, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M4 6.5h16M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5l.8 12.2A1.6 1.6 0 0 0 8.9 20.2h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12.2" />
    <path d="M10.4 10.4v5.8M13.6 10.4v5.8" />
  </svg>
);

export const Copy = ({ size = 16, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2.4" />
    <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 4h8A1.5 1.5 0 0 1 14.5 5.5V6" />
  </svg>
);

export const Check = ({ size = 16, strokeWidth = 1.6, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const Close = ({ size = 16, strokeWidth = 1.5, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
  </svg>
);

export const Plus = ({ size = 16, strokeWidth = 1.5, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Search = ({ size = 17, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <circle cx="11" cy="11" r="6.6" />
    <path d="M16 16l4.4 4.4" />
  </svg>
);

export const Upload = ({ size = 16, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M12 16V4.6M7.8 8.8L12 4.6l4.2 4.2" />
    <path d="M4.5 15.6v2.6A2.2 2.2 0 0 0 6.7 20.4h10.6a2.2 2.2 0 0 0 2.2-2.2v-2.6" />
  </svg>
);

export const Download = ({ size = 16, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M12 4.6V16M7.8 11.8L12 16l4.2-4.2" />
    <path d="M4.5 15.6v2.6A2.2 2.2 0 0 0 6.7 20.4h10.6a2.2 2.2 0 0 0 2.2-2.2v-2.6" />
  </svg>
);

export const Pencil = ({ size = 15, strokeWidth = 1.4, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M16.4 3.9a2 2 0 0 1 2.8 2.8L8.4 17.5l-3.7 1 1-3.7z" />
    <path d="M14.6 5.8l3.6 3.6" />
  </svg>
);

export const Arrow = ({ size = 16, strokeWidth = 1.6, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" />
  </svg>
);

export const Menu = ({ size = 20, strokeWidth = 1.5, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" style={base(size, style)} aria-hidden="true">
    <path d="M4 7.5h16M4 12h16M4 16.5h11" />
  </svg>
);

export const Leaf = ({ size = 18, strokeWidth = 1.2, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    <path d="M20 4C11 4 5.5 7.5 5 14c-.3 3.6 2 6 2 6s.9-4.4 4-7c2.7-2.3 6-3 6-3s-3.6 1.6-5.6 4.2C9.8 16.4 9 20 9 20c8 .6 11-5.5 11-16z" />
  </svg>
);

/* Signature botanical flourish used as page ornament */
export const Flourish = ({ width = 120, style }) => (
  <svg viewBox="0 0 200 30" fill="none" stroke="currentColor" strokeWidth="1"
    strokeLinecap="round" style={{ width, height: "auto", display: "block", ...style }} aria-hidden="true">
    <path d="M4 15c28-11 52 11 78 0s50-11 78 0" opacity="0.7" />
    <path d="M100 9c2.6 0 4.6 2 4.6 4.4S102.6 18 100 20c-2.6-2-4.6-4.2-4.6-6.6S97.4 9 100 9z" />
    <path d="M52 15c-4-5-9-5-13 0 4 5 9 5 13 0zM148 15c4-5 9-5 13 0-4 5-9 5-13 0z" opacity="0.75" />
  </svg>
);

/* ── Aurora additions ── */
const line = (paths) => ({ size = 16, strokeWidth = 1.6, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={base(size, style)} aria-hidden="true">
    {paths}
  </svg>
);

export const Star = line(<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />);
export const StarFill = ({ size = 16, style }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" style={base(size, style)} aria-hidden="true">
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />
  </svg>
);
export const Folder = line(<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10z" />);
export const Globe = line(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>);
export const Gear = line(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const Alert = line(<path d="M12 3 2.5 20h19L12 3zM12 10v4M12 17.2v.1" />);
export const Clock = line(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const Repeat = line(<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />);
export const External = line(<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />);
export const Note = line(<path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20V3.5zM14.5 3.5V8H19M9 12h6M9 15.5h6" />);
export const Timer = line(<><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 1.5M10 2.5h4" /></>);
export const User = line(<><circle cx="12" cy="8" r="4" /><path d="M4 20.5a8 8 0 0 1 16 0" /></>);
export const Logout = line(<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />);
export const Refresh = line(<path d="M20 11a8 8 0 0 0-14.8-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.8 3.5L20 15M20 20v-5h-5" />);
export const ShieldCheck = line(<><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z" /><path d="m9 12 2 2 4-4" /></>);
export const Grid = line(<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />);

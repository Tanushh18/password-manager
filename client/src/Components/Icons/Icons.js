import React from "react";

/* Line-art icon set — even strokes, rounded caps, inherits currentColor */

const base = (size, extra = {}) => ({
  width: size,
  height: size,
  display: "block",
  flexShrink: 0,
  ...extra,
});

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
  <svg viewBox="0 0 120 8" fill="none" stroke="currentColor" strokeWidth="1"
    strokeLinecap="round" style={{ width, height: 8, display: "block", ...style }} aria-hidden="true">
    <path d="M2 4h44" />
    <circle cx="60" cy="4" r="2.4" />
    <path d="M74 4h44" />
  </svg>
);

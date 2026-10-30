import React from "react";

/*
 * Shared page primitives. Styling lives in styles/system.css (.ui-*).
 * Keep these small and dumb: data and actions come from the page.
 */

/** Title row every app page starts with: title, one-line context, actions on the right. */
export function PageHeader({ title, subtitle, eyebrow, actions, children, className = "" }) {
  return (
    <header className={`ui-pagehead ${className}`}>
      <div className="ui-pagehead__text">
        {eyebrow ? <p className="ui-pagehead__eyebrow">{eyebrow}</p> : null}
        <h1 className="ui-pagehead__title">{title}</h1>
        {subtitle ? <p className="ui-pagehead__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ui-pagehead__actions">{actions}</div> : null}
      {children}
    </header>
  );
}

/** Card with a heading row; `actions` sit at the right of the heading. */
export function Panel({ title, subtitle, actions, children, className = "", as: Tag = "section", ...rest }) {
  return (
    <Tag className={`ui-panel ${className}`} {...rest}>
      {title || actions ? (
        <header className="ui-panel__head">
          <div>
            {title ? <h2 className="ui-panel__title">{title}</h2> : null}
            {subtitle ? <p className="ui-panel__sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="ui-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

/** Explains why a view is empty and what to do next. */
export function EmptyState({ icon, title, children, actions, compact = false, className = "" }) {
  return (
    <div className={`ui-empty ${compact ? "ui-empty--compact" : ""} ${className}`}>
      {icon ? <span className="ui-empty__icon" aria-hidden="true">{icon}</span> : null}
      <h2 className="ui-empty__title">{title}</h2>
      {children ? <p className="ui-empty__body">{children}</p> : null}
      {actions ? <div className="ui-empty__actions">{actions}</div> : null}
    </div>
  );
}

/** Small status label. tone: neutral | accent | ok | warn | danger | info */
export function Badge({ tone = "neutral", dot = false, children, className = "", ...rest }) {
  return (
    <span className={`ui-badge ui-badge--${tone} ${className}`} {...rest}>
      {dot ? <i className="ui-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Placeholder lines while content loads. */
export function Skeleton({ lines = 3, className = "" }) {
  return (
    <div className={`ui-skeleton ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${100 - (i % 3) * 18}%` }} />)}
    </div>
  );
}

/** Figure tile: a label, a number, a hint; a button when `onClick` or a link when `href`/`to` is wrapped by the caller. */
export function Stat({ label, value, hint, tone, onClick, className = "" }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`ui-stat ${tone ? `is-${tone}` : ""} ${onClick ? "is-action" : ""} ${className}`}>
      <span className="ui-stat__label">{label}</span>
      <strong className="ui-stat__value">{value}</strong>
      {hint ? <small className="ui-stat__hint">{hint}</small> : null}
    </Tag>
  );
}

import React, { useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Copy, Check, Eye, EyeOff, External } from "../Icons/Icons";
import { projectTree, countLeaves } from "../../lib/projectTree";
import "./ProjectTree.css";

export async function copyValue(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
    return true;
  } catch (e) {
    toast.error("Couldn't copy");
    return false;
  }
}

const href = (v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`);

const Chevron = ({ open }) => (
  <svg className={`ptree__chev ${open ? "is-open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/** One field: label, value, and copy / reveal / open buttons. */
export function TreeLeaf({ node, showPath, reveal = false }) {
  const [shown, setShown] = useState(reveal || !node.secret);
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (await copyValue(node.value, node.label)) {
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    }
  };
  return (
    <div className="ptree__leaf" role="treeitem" aria-selected="false">
      <div className="ptree__key">
        {showPath ? <span className="ptree__path">{showPath}</span> : null}
        <span className={node.mono ? "ptree__mono" : ""}>{node.label}</span>
        {node.hint ? <span className="ptree__hint">{node.hint}</span> : null}
      </div>
      <div className={`ptree__value ${node.mono || node.secret ? "ptree__mono" : ""}`} title={shown ? node.value : ""}>
        {shown ? node.value : "••••••••••"}
      </div>
      <div className="ptree__tools">
        {node.secret ? (
          <button type="button" className="icon-btn" onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide value" : "Show value"}>
            {shown ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        ) : null}
        {node.link ? (
          <a className="icon-btn" href={href(node.value)} target="_blank" rel="noreferrer" aria-label="Open link">
            <External size={14} />
          </a>
        ) : null}
        <button type="button" className={`icon-btn ${done ? "is-done" : ""}`} onClick={copy} aria-label={`Copy ${node.label}`}>
          {done ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

function TreeBranch({ node, depth, openSet, toggle }) {
  const open = openSet.has(node.id);
  return (
    <div className="ptree__branch" role="treeitem" aria-expanded={open} aria-selected="false">
      <button type="button" className="ptree__head" style={{ paddingLeft: `${depth * 16 + 4}px` }} onClick={() => toggle(node.id)}>
        <Chevron open={open} />
        <span className="ptree__label">{node.label}</span>
        <span className="ptree__count">{countLeaves(node)}</span>
      </button>
      {open ? (
        <div className="ptree__children" role="group" style={{ marginLeft: `${depth * 16 + 10}px` }}>
          {node.children.map((child, i) =>
            child.children ? (
              <TreeBranch key={child.id || i} node={child} depth={depth + 1} openSet={openSet} toggle={toggle} />
            ) : (
              <TreeLeaf key={`${child.label}-${i}`} node={child} />
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

const allIds = (nodes) => nodes.flatMap((n) => (n.children ? [n.id, ...allIds(n.children)] : []));

/**
 * Collapsible structure of one project: sections → (databases →) fields.
 * `expanded` opens every branch at first; otherwise all start closed.
 */
export default function ProjectTree({ project, expanded = false, compact = false }) {
  const tree = useMemo(() => projectTree(project), [project]);
  const ids = useMemo(() => allIds(tree), [tree]);
  const [openSet, setOpenSet] = useState(() => new Set(expanded ? ids : []));

  const toggle = (id) =>
    setOpenSet((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!tree.length) return <p className="ptree__empty">No details yet.</p>;

  const allOpen = ids.every((id) => openSet.has(id));
  return (
    <div className={`ptree ${compact ? "ptree--compact" : ""}`}>
      <div className="ptree__bar">
        <button type="button" className="ptree__all" onClick={() => setOpenSet(new Set(allOpen ? [] : ids))}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div role="tree" aria-label={`${project.name} structure`}>
        {tree.map((node) => (
          <TreeBranch key={node.id} node={node} depth={0} openSet={openSet} toggle={toggle} />
        ))}
      </div>
    </div>
  );
}

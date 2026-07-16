import { useEffect, useRef } from "react";

import type { ColumnDefinition, Locale, WorkflowTree } from "../types";
import { translate } from "../i18n/translations";

interface WorkflowTreePanelProps {
  locale: Locale;
  tree: WorkflowTree | undefined;
  columns: ColumnDefinition[];
  loading: boolean;
}

function formatContext(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function WorkflowTreePanel({
  locale,
  tree,
  columns,
  loading,
}: WorkflowTreePanelProps) {
  const selectedRef = useRef<HTMLLIElement | null>(null);
  const selectedColumn = columns.find((column) => column.key === tree?.selected_cell_key);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [tree?.selected_record_id]);

  return (
    <aside className="tree-panel">
      <div className="tree-panel__header">
        <div>
          <span className="eyebrow">LIVE CONTEXT</span>
          <h2>{translate(locale, "workflowTree")}</h2>
        </div>
        <span className="tree-panel__count">{tree?.nodes.length || 0}</span>
      </div>

      <section className="context-card">
        <span>{translate(locale, "selectedContext")}</span>
        {tree?.selected_record_id ? (
          <>
            <b>{selectedColumn?.label || translate(locale, "cell")}</b>
            <pre>{formatContext(tree.selected_cell_value)}</pre>
          </>
        ) : (
          <p>{translate(locale, "selectPrompt")}</p>
        )}
      </section>

      <div className="tree-scroll" aria-busy={loading}>
        {loading ? (
          <div className="tree-loading">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} style={{ animationDelay: `${index * 70}ms` }} />
            ))}
          </div>
        ) : (
          <ol className="workflow-tree">
            {(tree?.nodes || []).map((node) => {
              const state = node.is_selected
                ? "current"
                : node.is_before_selected
                  ? "complete"
                  : "upcoming";
              return (
                <li
                  className={`workflow-node workflow-node--${state}`}
                  key={node.record_key}
                  ref={node.is_selected ? selectedRef : undefined}
                >
                  <div className="workflow-node__rail">
                    <span>{String(node.order).padStart(2, "0")}</span>
                  </div>
                  <div className="workflow-node__body">
                    <small>
                      {state === "current"
                        ? translate(locale, "currentStep")
                        : state === "complete"
                          ? translate(locale, "completedStep")
                          : translate(locale, "upcomingStep")}
                    </small>
                    <b>{node.label}</b>
                    {node.owner_role || node.time_limit ? (
                      <span>
                        {[node.owner_role, node.time_limit].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}

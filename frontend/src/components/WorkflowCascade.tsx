import type { Locale, WorkflowSummary } from "../types";
import { translate } from "../i18n/translations";

interface WorkflowCascadeProps {
  locale: Locale;
  workflows: WorkflowSummary[];
  selectedGroup: string;
  selectedWorkflow: string;
  onGroupSelect: (group: string) => void;
  onWorkflowSelect: (workflow: string) => void;
}

interface GroupItem {
  key: string;
  name: string;
  count: number;
}

export function WorkflowCascade({
  locale,
  workflows,
  selectedGroup,
  selectedWorkflow,
  onGroupSelect,
  onWorkflowSelect,
}: WorkflowCascadeProps) {
  const groups = workflows.reduce<GroupItem[]>((items, workflow) => {
    if (!items.some((item) => item.key === workflow.group_key)) {
      items.push({
        key: workflow.group_key,
        name: workflow.group_name,
        count: workflows.filter((candidate) => candidate.group_key === workflow.group_key)
          .length,
      });
    }
    return items;
  }, []);
  const master = workflows.find((workflow) => workflow.is_master);
  const children = workflows.filter(
    (workflow) => workflow.group_key === selectedGroup && !workflow.is_master,
  );

  return (
    <section className="cascade" aria-label={translate(locale, "navigator")}>
      <div className="cascade__title">
        <span>01</span>
        <div>
          <b>{translate(locale, "navigator")}</b>
          <small>Workbook → domain → workflow</small>
        </div>
      </div>

      <div className="cascade__lane cascade__lane--master">
        <span className="cascade__label">{translate(locale, "master")}</span>
        {master ? (
          <button
            className={selectedWorkflow === master.key ? "is-active" : ""}
            onClick={() => onWorkflowSelect(master.key)}
            type="button"
          >
            <b>{master.name}</b>
            <small>{master.record_count}</small>
          </button>
        ) : null}
      </div>

      <div className="cascade__arrow" aria-hidden="true">›</div>

      <div className="cascade__lane cascade__lane--groups">
        <span className="cascade__label">{translate(locale, "domain")}</span>
        <div className="cascade__scroll">
          {groups.map((group) => (
            <button
              className={selectedGroup === group.key ? "is-active" : ""}
              key={group.key}
              onClick={() => onGroupSelect(group.key)}
              type="button"
            >
              <b>{group.name}</b>
              <small>{group.count}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="cascade__arrow" aria-hidden="true">›</div>

      <div className="cascade__lane cascade__lane--workflows">
        <span className="cascade__label">{translate(locale, "subworkflow")}</span>
        <div className="cascade__scroll">
          {children.map((workflow) => (
            <button
              className={selectedWorkflow === workflow.key ? "is-active" : ""}
              key={workflow.key}
              onClick={() => onWorkflowSelect(workflow.key)}
              type="button"
            >
              <b>{workflow.name}</b>
              <small>{workflow.record_count}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}


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

const PEOPLE_GROUP = "hr";

export function WorkflowCascade({
  locale,
  workflows,
  selectedGroup,
  selectedWorkflow,
  onGroupSelect,
  onWorkflowSelect,
}: WorkflowCascadeProps) {
  const tabs: GroupItem[] = [
    {
      key: "customer-relations",
      name: translate(locale, "customerRelations"),
      count: workflows.filter(
        (workflow) => !workflow.is_master && workflow.group_key !== PEOPLE_GROUP,
      ).length,
    },
    {
      key: "people-operations",
      name: translate(locale, "peopleOperations"),
      count: workflows.filter(
        (workflow) => !workflow.is_master && workflow.group_key === PEOPLE_GROUP,
      ).length,
    },
  ];
  const activeTabKey = selectedGroup === PEOPLE_GROUP
    ? "people-operations"
    : "customer-relations";
  const children = workflows.filter(
    (workflow) =>
      !workflow.is_master &&
      (activeTabKey === "people-operations"
        ? workflow.group_key === PEOPLE_GROUP
        : workflow.group_key !== PEOPLE_GROUP),
  );

  return (
    <section className="cascade" aria-label={translate(locale, "navigator")}>
      <div className="cascade__tabs" role="tablist" aria-label={translate(locale, "businessArea")}>
        {tabs.map((tab) => (
          <button
            aria-selected={activeTabKey === tab.key}
            className={activeTabKey === tab.key ? "is-active" : ""}
            key={tab.key}
            onClick={() => onGroupSelect(tab.key)}
            role="tab"
            type="button"
          >
            <b>{tab.name}</b>
            <small>{tab.count}</small>
          </button>
        ))}
      </div>

      <div className="cascade__lane cascade__lane--workflows" role="tabpanel">
        <span className="cascade__label">{translate(locale, "subworkflow")}</span>
        <div
          className="cascade__scroll"
          role="tablist"
          aria-label={`${activeTabKey} ${translate(locale, "subworkflow")}`}
        >
          {children.map((workflow) => (
            <button
              aria-selected={selectedWorkflow === workflow.key}
              className={selectedWorkflow === workflow.key ? "is-active" : ""}
              key={workflow.key}
              onClick={() => onWorkflowSelect(workflow.key)}
              role="tab"
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

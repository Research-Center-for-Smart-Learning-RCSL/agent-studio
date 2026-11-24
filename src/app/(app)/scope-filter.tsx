"use client";

import { useEffect, useMemo, useState } from "react";
import { Select } from "antd";
import { useI18n } from "@/lib/i18n-client";

type Project = { id: string; name: string; organizationId: string; organizationName: string };
type Scope = { organization?: string; project?: string };

function uniqueOptions(options: { value: string; label: string }[]) {
  const counts = new Map<string, number>();
  for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  return options.map((option) => counts.get(option.label) === 1 ? option : { ...option, label: `${option.label} (${option.value})` });
}

function announceScope(scope: Scope, userInitiated = false) {
  window.dispatchEvent(new CustomEvent("agent-studio-scope", { detail: { ...scope, userInitiated } }));
}

export function ScopeFilter({ projects, userEmail }: { projects: Project[]; userEmail: string }) {
  const { t } = useI18n();
  const storageKey = `agent-studio:scope:${userEmail}`;
  const [organization, setOrganization] = useState<string>();
  const [project, setProject] = useState<string>();
  const organizations = useMemo(() => {
    const values = new Map(projects.map((p) => [p.organizationId, p.organizationName]));
    return uniqueOptions([...values].map(([value, label]) => ({ value, label })));
  }, [projects]);
  const projectOptions = useMemo(() => uniqueOptions(projects
    .filter((item) => !organization || item.organizationId === organization)
    .map((item) => ({ value: item.id, label: organization ? item.name : `${item.organizationName} / ${item.name}` }))), [organization, projects]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Scope | null;
      const org = projects.some((item) => item.organizationId === saved?.organization) ? saved!.organization : undefined;
      const proj = org && projects.some((item) => item.organizationId === org && item.id === saved?.project) ? saved!.project : undefined;
      queueMicrotask(() => {
        setOrganization(org);
        setProject(proj);
      });
      // The stored choice may name a project that is gone or no longer readable; keep what the header shows.
      if (saved && (saved.organization !== org || saved.project !== proj)) localStorage.setItem(storageKey, JSON.stringify({ organization: org, project: proj }));
      announceScope({ organization: org, project: proj });
    } catch { /* Storage can be unavailable or stale. */ }
  }, [projects, storageKey]);

  function updateScope(org?: string, proj?: string) {
    setOrganization(org);
    setProject(proj);
    const next = { organization: org, project: proj };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Storage is optional. */ }
    announceScope(next, true);
  }

  return (
    <div className="header-scope" aria-label={t("專案篩選")}>
      <Select
        aria-label={t("組織")}
        placeholder={t("所有組織")}
        allowClear
        showSearch={{ optionFilterProp: "label" }}
        options={organizations}
        value={organization}
        onChange={(value) => updateScope(value, undefined)}
      />
      <Select
        aria-label={t("專案")}
        placeholder={organization ? t("所有專案") : t("請先選擇組織")}
        disabled={!organization}
        allowClear
        showSearch={{ optionFilterProp: "label" }}
        options={projectOptions}
        value={project}
        onChange={(value) => updateScope(organization, value)}
      />
    </div>
  );
}

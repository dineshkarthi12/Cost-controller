import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { moduleByKey } from '@toprock/shared';
import { Page } from '../components/layout/AppShell';
import { ModuleTabsNav, ResourceCreate, ResourceDetail, ResourceEdit, ResourceList } from './resources/ResourceViews';

export interface TabDef {
  label: string;
  path: string;
  resource?: string;
  /** Custom list/overview page for the tab. */
  element?: ReactNode;
  /** Custom create page (replaces the generic form). */
  createElement?: ReactNode;
  /** Custom detail page. */
  detailElement?: ReactNode;
  listProps?: Partial<Parameters<typeof ResourceList>[0]>;
}

export function ModuleShell({ moduleKey, tabs, children }: { moduleKey: string; tabs: TabDef[]; children: ReactNode }) {
  const location = useLocation();
  const mod = moduleByKey(moduleKey);
  const active = tabs.find((t) => t.path === location.pathname)?.path ?? tabs[0]?.path ?? '';
  return (
    <Page>
      {tabs.length > 1 && (
        <>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{mod?.label}</p>
          <ModuleTabsNav tabs={tabs} active={active} />
        </>
      )}
      {children}
    </Page>
  );
}

/** Generates list / new / detail / edit routes for every tab of a module. */
export function moduleRoutes(moduleKey: string, tabs: TabDef[]) {
  return tabs.flatMap((t) => {
    const routes: Array<{ path: string; element: ReactNode }> = [];
    const list = t.element ?? (t.resource ? <ResourceList resourceKey={t.resource} basePath={t.path} title={t.label} {...t.listProps} /> : null);
    if (list) routes.push({ path: t.path, element: <ModuleShell moduleKey={moduleKey} tabs={tabs}>{list}</ModuleShell> });
    if (t.resource) {
      routes.push({ path: `${t.path}/new`, element: t.createElement ?? <ResourceCreate resourceKey={t.resource} basePath={t.path} /> });
      routes.push({ path: `${t.path}/:id`, element: t.detailElement ?? <ResourceDetail resourceKey={t.resource} basePath={t.path} /> });
      routes.push({ path: `${t.path}/:id/edit`, element: <ResourceEdit resourceKey={t.resource} basePath={t.path} /> });
    }
    return routes;
  });
}

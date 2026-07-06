// Read-only sandbox API reference drawers (issue #30). Rendered in the Script
// Console's lower pane whenever a sheet's console output is closed. Plain
// DOM/CSS, no framework (repo rule 5); all data comes from the central
// registry in src/sandbox/apiDocs.ts.
import { attachSplitterDrag } from './splitter';
import {
  SANDBOX_API_DOCS,
  filterDocs,
  sortDocs,
  type SandboxApiDoc,
  type SandboxApiSortDirection,
  type SandboxApiSortKey,
} from '../../sandbox/apiDocs';

export interface ApiReferencePanel {
  readonly el: HTMLElement;
}

interface SortState {
  key: SandboxApiSortKey;
  direction: SandboxApiSortDirection;
}

const SORT_OPTIONS: readonly { value: string; label: string; state: SortState }[] = [
  { value: 'name-asc', label: 'Name A–Z', state: { key: 'name', direction: 'asc' } },
  { value: 'name-desc', label: 'Name Z–A', state: { key: 'name', direction: 'desc' } },
  { value: 'description-asc', label: 'Description A–Z', state: { key: 'description', direction: 'asc' } },
  { value: 'description-desc', label: 'Description Z–A', state: { key: 'description', direction: 'desc' } },
];

function sortSelect(onChange: (state: SortState) => void): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'api-ref-sort';
  select.title = 'Sort';
  for (const opt of SORT_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    const chosen = SORT_OPTIONS.find((o) => o.value === select.value) ?? SORT_OPTIONS[0]!;
    onChange(chosen.state);
  });
  return select;
}

export function createApiReferencePanel(): ApiReferencePanel {
  const el = document.createElement('div');
  el.className = 'script-api-reference';

  const drawers = document.createElement('div');
  drawers.className = 'api-ref-drawers';
  el.append(drawers);

  const variables = SANDBOX_API_DOCS.filter((d) => d.kind === 'variable');
  const functions = SANDBOX_API_DOCS.filter((d) => d.kind === 'function');

  interface Drawer {
    docs: readonly SandboxApiDoc[];
    sort: SortState;
    emptyText: string;
    section: HTMLElement;
    body: HTMLElement;
    filter: HTMLInputElement;
  }

  // Each drawer header is its own filter input (the drawer's name doubles as
  // the placeholder) plus a sort select — no separate toolbar row.
  function buildDrawer(name: string, docs: readonly SandboxApiDoc[], emptyText: string): Drawer {
    const section = document.createElement('section');
    section.className = 'api-ref-drawer';
    const header = document.createElement('div');
    header.className = 'api-ref-drawer-header';
    const filter = document.createElement('input');
    filter.className = 'api-ref-filter';
    filter.type = 'search';
    filter.placeholder = name;
    filter.setAttribute('aria-label', `Filter ${name.toLowerCase()}`);
    const drawer: Drawer = {
      docs,
      sort: SORT_OPTIONS[0]!.state,
      emptyText,
      section,
      body: document.createElement('div'),
      filter,
    };
    const select = sortSelect((state) => {
      drawer.sort = state;
      renderDrawer(drawer);
    });
    filter.addEventListener('input', () => renderDrawer(drawer));
    header.append(filter, select);
    drawer.body.className = 'api-ref-rows';
    section.append(header, drawer.body);
    return drawer;
  }

  const variablesDrawer = buildDrawer('Variables & constants', variables, 'No matching variables.');
  const functionsDrawer = buildDrawer('Functions', functions, 'No matching functions.');

  // Draggable divider between the two drawers — shares the drag behavior of
  // the editor/output splitter, but horizontal and session-local (not
  // persisted).
  const splitter = document.createElement('div');
  splitter.className = 'api-ref-splitter';
  splitter.role = 'separator';
  splitter.title = 'Resize drawers';
  attachSplitterDrag(splitter, {
    axis: 'x',
    container: drawers,
    resizeTarget: drawers,
    min: 0.2,
    max: 0.8,
    onRatio: (ratio) => {
      // Fix the left drawer at the ratio and let the right one absorb the
      // remainder — the splitter's own width then can't skew the split.
      const left = variablesDrawer.section.style;
      left.flexGrow = '0';
      left.flexShrink = '0';
      left.flexBasis = `${(ratio * 100).toFixed(2)}%`;
      const right = functionsDrawer.section.style;
      right.flexGrow = '1';
      right.flexShrink = '1';
      right.flexBasis = 'auto';
    },
  });

  drawers.append(variablesDrawer.section, splitter, functionsDrawer.section);

  function renderRow(doc: SandboxApiDoc): HTMLElement {
    const row = document.createElement('div');
    row.className = `api-ref-row ${doc.source}`;
    const name = document.createElement('span');
    name.className = 'api-ref-name';
    name.textContent = doc.kind === 'function' ? `${doc.name}(${doc.args})` : doc.name;
    const detail = document.createElement('span');
    detail.className = 'api-ref-detail';
    detail.textContent =
      doc.kind === 'variable' ? `${doc.value} — ${doc.description}` : doc.description;
    row.append(name, detail);
    return row;
  }

  function renderDrawer(drawer: Drawer): void {
    const visible = sortDocs(filterDocs(drawer.docs, drawer.filter.value), drawer.sort.key, drawer.sort.direction);
    drawer.body.textContent = '';
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'api-ref-empty';
      empty.textContent = drawer.emptyText;
      drawer.body.appendChild(empty);
      return;
    }
    for (const doc of visible) drawer.body.appendChild(renderRow(doc));
  }

  renderDrawer(variablesDrawer);
  renderDrawer(functionsDrawer);

  return { el };
}

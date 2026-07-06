// Read-only sandbox API reference drawers (issue #30). Rendered in the Script
// Console's lower pane whenever a sheet's console output is closed. Plain
// DOM/CSS, no framework (repo rule 5); all data comes from the central
// registry in src/sandbox/apiDocs.ts.
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
  // Toggle the "Show last output" affordance (shown when the sheet has
  // output history) and wire its click handler.
  setShowLastOutput(visible: boolean): void;
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

export function createApiReferencePanel(onShowLastOutput: () => void): ApiReferencePanel {
  const el = document.createElement('div');
  el.className = 'script-api-reference';

  // ---- toolbar: shared filter + Show last output ----
  const toolbar = document.createElement('div');
  toolbar.className = 'api-ref-toolbar';
  const filterInput = document.createElement('input');
  filterInput.className = 'api-ref-filter';
  filterInput.type = 'search';
  filterInput.placeholder = 'Filter API by name or description...';
  filterInput.setAttribute('aria-label', 'Filter API by name or description');
  const showOutputBtn = document.createElement('button');
  showOutputBtn.className = 'api-ref-show-output';
  showOutputBtn.type = 'button';
  showOutputBtn.textContent = 'Show last output';
  showOutputBtn.hidden = true;
  showOutputBtn.addEventListener('click', onShowLastOutput);
  toolbar.append(filterInput, showOutputBtn);

  const drawers = document.createElement('div');
  drawers.className = 'api-ref-drawers';
  el.append(toolbar, drawers);

  const variables = SANDBOX_API_DOCS.filter((d) => d.kind === 'variable');
  const functions = SANDBOX_API_DOCS.filter((d) => d.kind === 'function');

  interface Drawer {
    docs: readonly SandboxApiDoc[];
    sort: SortState;
    emptyText: string;
    body: HTMLElement;
  }

  function buildDrawer(title: string, docs: readonly SandboxApiDoc[], emptyText: string): Drawer {
    const section = document.createElement('section');
    section.className = 'api-ref-drawer';
    const header = document.createElement('div');
    header.className = 'api-ref-drawer-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'api-ref-drawer-title';
    titleEl.textContent = title;
    const drawer: Drawer = {
      docs,
      sort: SORT_OPTIONS[0]!.state,
      emptyText,
      body: document.createElement('div'),
    };
    const select = sortSelect((state) => {
      drawer.sort = state;
      render();
    });
    header.append(titleEl, select);
    drawer.body.className = 'api-ref-rows';
    section.append(header, drawer.body);
    drawers.appendChild(section);
    return drawer;
  }

  const variablesDrawer = buildDrawer('Variables & constants', variables, 'No matching variables.');
  const functionsDrawer = buildDrawer('Functions', functions, 'No matching functions.');

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
    const visible = sortDocs(filterDocs(drawer.docs, filterInput.value), drawer.sort.key, drawer.sort.direction);
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

  function render(): void {
    renderDrawer(variablesDrawer);
    renderDrawer(functionsDrawer);
  }

  filterInput.addEventListener('input', render);
  render();

  return {
    el,
    setShowLastOutput(visible: boolean): void {
      showOutputBtn.hidden = !visible;
    },
  };
}

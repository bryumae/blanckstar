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
import type { SandboxVarEntry } from '../../sandbox/vars';
import { SANDBOX_VAR_DESCRIPTION_LIMIT } from '../../sandbox/vars';

interface SortState {
  key: SandboxApiSortKey;
  direction: SandboxApiSortDirection;
}

const BASE_SORT_OPTIONS: readonly { value: string; label: string; state: SortState }[] = [
  { value: 'name-asc', label: 'Name A–Z', state: { key: 'name', direction: 'asc' } },
  { value: 'name-desc', label: 'Name Z–A', state: { key: 'name', direction: 'desc' } },
  { value: 'description-asc', label: 'Description A–Z', state: { key: 'description', direction: 'asc' } },
  { value: 'description-desc', label: 'Description Z–A', state: { key: 'description', direction: 'desc' } },
];

const VARIABLE_SORT_OPTIONS: readonly { value: string; label: string; state: SortState }[] = [
  ...BASE_SORT_OPTIONS,
  { value: 'modified-desc', label: 'Modified newest', state: { key: 'modified', direction: 'desc' } },
  { value: 'modified-asc', label: 'Modified oldest', state: { key: 'modified', direction: 'asc' } },
];

export interface ApiReferenceVarsStore {
  list(): readonly SandboxVarEntry[];
  setDescription(name: string, description: string): void;
  deleteValue(name: string): void;
  subscribe(listener: () => void): () => void;
}

export interface ApiReferencePanelHandle {
  readonly element: HTMLElement;
  destroy(): void;
}

function sortSelect(
  options: readonly { value: string; label: string; state: SortState }[],
  onChange: (state: SortState) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'api-ref-sort';
  select.title = 'Sort';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    onChange(options[select.selectedIndex]!.state);
  });
  return select;
}

// Returns the panel's root element — the side-by-side drawers container
// itself; the caller toggles it against the console output view.
export function createApiReferencePanel(varsStore?: ApiReferenceVarsStore): ApiReferencePanelHandle {
  const el = document.createElement('div');
  el.className = 'script-api-reference';

  interface Drawer {
    docs: readonly SandboxApiDoc[];
    sort: SortState;
    sortOptions: readonly { value: string; label: string; state: SortState }[];
    emptyText: string;
    section: HTMLElement;
    body: HTMLElement;
    filter: HTMLInputElement;
  }

  // Each drawer header is its own filter input (the drawer's name doubles as
  // the placeholder) plus a sort select — no separate toolbar row.
  function buildDrawer(
    name: string,
    docs: readonly SandboxApiDoc[],
    emptyText: string,
    sortOptions = BASE_SORT_OPTIONS,
  ): Drawer {
    const section = document.createElement('section');
    section.className = 'api-ref-drawer';
    // The drawer name lives in the filter placeholder, which disappears once
    // the user types — the section keeps the name for assistive tech (and
    // as a hover tooltip) so the two panes stay distinguishable.
    section.setAttribute('aria-label', name);
    section.title = name;
    const header = document.createElement('div');
    header.className = 'api-ref-drawer-header';
    const filter = document.createElement('input');
    filter.className = 'api-ref-filter';
    filter.type = 'search';
    filter.placeholder = name;
    filter.setAttribute('aria-label', `Filter ${name.toLowerCase()}`);
    const drawer: Drawer = {
      docs,
      sort: sortOptions[0]!.state,
      sortOptions,
      emptyText,
      section,
      body: document.createElement('div'),
      filter,
    };
    const select = sortSelect(sortOptions, (state) => {
      drawer.sort = state;
      renderDrawer(drawer);
    });
    filter.addEventListener('input', () => renderDrawer(drawer));
    header.append(filter, select);
    drawer.body.className = 'api-ref-rows';
    section.append(header, drawer.body);
    renderDrawer(drawer);
    return drawer;
  }

  function renderRow(doc: SandboxApiDoc): HTMLElement {
    const row = document.createElement('div');
    row.className = `api-ref-row ${doc.source}`;
    const name = document.createElement('span');
    name.className = 'api-ref-name';
    name.textContent = doc.kind === 'function' ? `${doc.name}(${doc.args})` : doc.name;
    const detail = document.createElement('span');
    detail.className = 'api-ref-detail';
    if (doc.kind === 'variable') {
      const value = document.createElement('span');
      value.className = 'api-ref-value';
      value.textContent = doc.value;
      if (doc.source === 'player') {
        const input = document.createElement('input');
        input.className = 'api-ref-description-input';
        input.value = doc.description;
        input.placeholder = 'Description';
        input.maxLength = SANDBOX_VAR_DESCRIPTION_LIMIT;
        input.setAttribute('aria-label', `Description for ${doc.name}`);
        const persistDescription = () => {
          try {
            varsStore?.setDescription(doc.name, input.value);
            input.setCustomValidity('');
          } catch (err) {
            input.setCustomValidity(err instanceof Error ? err.message : String(err));
            input.reportValidity();
            input.value = doc.description;
          }
        };
        input.addEventListener('change', persistDescription);
        input.addEventListener('blur', persistDescription);
        const modified = document.createElement('span');
        modified.className = 'api-ref-modified';
        modified.textContent = doc.modified ? new Date(doc.modified).toISOString() : '';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'api-ref-delete';
        del.textContent = 'x';
        del.title = `Delete ${doc.name}`;
        del.setAttribute('aria-label', `Delete ${doc.name}`);
        del.addEventListener('click', () => {
          if (confirm(`Delete vars.${doc.name}?`)) varsStore?.deleteValue(doc.name);
        });
        detail.append(value, input, modified, del);
      } else {
        detail.textContent = `${doc.value} — ${doc.description}`;
      }
    } else {
      detail.textContent = doc.description;
    }
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

  const variablesDrawer = buildDrawer(
    'Variables & constants',
    variableDocs(),
    'No matching variables.',
    VARIABLE_SORT_OPTIONS,
  );
  const functionsDrawer = buildDrawer(
    'Functions',
    SANDBOX_API_DOCS.filter((d) => d.kind === 'function'),
    'No matching functions.',
  );

  // Draggable divider between the two drawers — shares the drag behavior of
  // the editor/output splitter, but horizontal and session-local (not
  // persisted).
  const splitter = document.createElement('div');
  splitter.className = 'api-ref-splitter';
  // setAttribute, not the .role IDL property — ARIA reflection is missing in
  // older engines, where the property assignment is a silent expando.
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-orientation', 'vertical');
  splitter.setAttribute('aria-label', 'Resize drawers');
  splitter.title = 'Resize drawers';
  attachSplitterDrag(splitter, {
    axis: 'x',
    container: el,
    resizeTarget: el,
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

  el.append(variablesDrawer.section, splitter, functionsDrawer.section);

  const unsubscribe = varsStore?.subscribe(() => {
    variablesDrawer.docs = variableDocs();
    renderDrawer(variablesDrawer);
  });

  return {
    element: el,
    destroy(): void {
      unsubscribe?.();
    },
  };

  function variableDocs(): readonly SandboxApiDoc[] {
    const builtin = SANDBOX_API_DOCS.filter((d) => d.kind === 'variable');
    const player =
      varsStore?.list().map((entry): SandboxApiDoc => ({
        kind: 'variable',
        name: entry.name,
        description: entry.description,
        source: 'player',
        value: formatVarValue(entry.value),
        modified: entry.modified,
      })) ?? [];
    return [...builtin, ...player];
  }
}

function formatVarValue(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

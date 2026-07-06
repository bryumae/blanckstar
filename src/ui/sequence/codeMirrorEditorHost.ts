import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  currentCompletions,
  insertCompletionText,
  pickedCompletion,
  selectedCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import {
  EditorState,
  RangeSetBuilder,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  type Command,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  type Tooltip,
} from '@codemirror/view';
import type { SandboxApiDoc } from '../../sandbox/apiDocs';
import {
  formatSandboxDoc,
  sandboxDocForName,
  scriptCompletionEntries,
  type ScriptCompletionEntry,
} from './editorCompletions';
import type { EditorHost, EditorHostOptions } from './editorHost';

const setErrorLineEffect = StateEffect.define<number | null>();

const errorLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    let mapped = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setErrorLineEffect)) continue;
      const lineNumber = effect.value;
      if (lineNumber === null) return Decoration.none;
      const line = transaction.state.doc.line(Math.max(1, Math.min(lineNumber, transaction.state.doc.lines)));
      const builder = new RangeSetBuilder<Decoration>();
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-script-error-line' }));
      mapped = builder.finish();
    }
    return mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function apiInfoNode(entry: ScriptCompletionEntry): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-script-completion-info';
  const lines = entry.info.split('\n\n');
  const title = document.createElement('div');
  title.className = 'cm-script-completion-title';
  title.textContent = lines[0] ?? entry.displayLabel ?? entry.label;
  const body = document.createElement('div');
  body.textContent = lines.slice(1).join('\n\n');
  dom.append(title, body);
  return dom;
}

function completionSource(options: EditorHostOptions | undefined) {
  return (context: CompletionContext): CompletionResult | null => {
    const member = context.matchBefore(/(?:^|[^A-Za-z0-9_$])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/);
    if (member) {
      const match = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/.exec(member.text);
      const objectName = match?.[1] ?? null;
      const prefix = match?.[2] ?? '';
      const entries = scriptCompletionEntries({ objectName, prefix, varsStore: options?.varsStore });
      return entries.length === 0
        ? null
        : {
            from: context.pos - prefix.length,
            options: entries.map(toCodeMirrorCompletion),
            validFor: /^[\w$]*$/,
          };
    }

    const word = context.matchBefore(/[A-Za-z_$][\w$]*/);
    if (!word && !context.explicit) return null;
    const prefix = word?.text ?? '';
    const entries = scriptCompletionEntries({ objectName: null, prefix, varsStore: options?.varsStore });
    return {
      from: word?.from ?? context.pos,
      options: entries.map(toCodeMirrorCompletion),
      validFor: /^[\w$]*$/,
    };
  };
}

function completionRangeAt(state: EditorState): { from: number; to: number } | null {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const member = /(?:^|[^A-Za-z0-9_$])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/.exec(before);
  if (member) {
    const prefix = member[2] ?? '';
    return { from: pos - prefix.length, to: pos };
  }
  const word = /[A-Za-z_$][\w$]*$/.exec(before);
  return word ? { from: pos - word[0].length, to: pos } : { from: pos, to: pos };
}

const acceptCompletionOrFallback: Command = (view) => {
  if (completionStatus(view.state) !== 'active') return false;
  if (acceptCompletion(view)) return true;
  const completion = selectedCompletion(view.state) ?? currentCompletions(view.state)[0];
  const range = completionRangeAt(view.state);
  if (!completion || !range) return false;
  if (typeof completion.apply === 'function') {
    completion.apply(view, completion, range.from, range.to);
    return true;
  }
  const insert = completion.apply ?? completion.label;
  view.dispatch({
    ...insertCompletionText(view.state, insert, range.from, range.to),
    annotations: pickedCompletion.of(completion),
  });
  return true;
};

function toCodeMirrorCompletion(entry: ScriptCompletionEntry) {
  return {
    label: entry.label,
    displayLabel: entry.displayLabel,
    apply: entry.apply,
    detail: entry.detail,
    type: entry.type,
    section: entry.section,
    info: () => apiInfoNode(entry),
  };
}

interface ApiToken {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

function apiTokenAt(state: EditorState, pos: number): ApiToken | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  const text = line.text;
  let from = offset;
  let to = offset;
  while (from > 0 && /[A-Za-z0-9_.$]/.test(text[from - 1]!)) from -= 1;
  while (to < text.length && /[A-Za-z0-9_.$]/.test(text[to]!)) to += 1;
  const raw = text.slice(from, to);
  const trimStart = raw.match(/^\.+/)?.[0].length ?? 0;
  const trimEnd = raw.match(/\.+$/)?.[0].length ?? 0;
  const name = raw.slice(trimStart, raw.length - trimEnd);
  return name === ''
    ? null
    : {
        name,
        from: line.from + from + trimStart,
        to: line.from + to - trimEnd,
      };
}

function hoverInfo(doc: SandboxApiDoc): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-script-hover';
  const title = document.createElement('div');
  title.className = 'cm-script-hover-title';
  title.textContent = formatSandboxDoc(doc);
  const body = document.createElement('div');
  body.textContent =
    doc.kind === 'function' && doc.async
      ? `${doc.description} Use await.`
      : doc.description;
  dom.append(title, body);
  return dom;
}

function apiHover(): Extension {
  return hoverTooltip((view, pos): Tooltip | null => {
    const token = apiTokenAt(view.state, pos);
    if (!token) return null;
    const doc = sandboxDocForName(token.name);
    if (!doc) return null;
    return {
      pos: token.from,
      end: token.to,
      above: true,
      create() {
        return { dom: hoverInfo(doc) };
      },
    };
  });
}

function editorTheme(): Extension {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        color: 'var(--text-secondary)',
        backgroundColor: 'var(--bg-viewport)',
        fontSize: '12.5px',
      },
      '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.65',
      },
      '.cm-content': {
        padding: '12px 14px 12px 0',
        caretColor: 'var(--accent)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-viewport)',
        color: 'var(--text-faint)',
        border: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 14px 0 0',
        minWidth: '44px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--bg-active)',
        color: 'var(--text-tertiary)',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(76, 201, 224, 0.06)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'rgba(76, 201, 224, 0.24)',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-script-error-line': {
        backgroundColor: 'rgba(224, 101, 95, 0.16)',
        boxShadow: 'inset 3px 0 0 var(--status-danger)',
      },
      '.cm-tooltip': {
        border: '1px solid var(--border-secondary)',
        backgroundColor: 'var(--bg-input)',
        color: 'var(--text-primary)',
        borderRadius: 'var(--radius-control)',
        fontFamily: 'var(--font-ui)',
        fontSize: '11px',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--accent)',
        color: 'var(--bg-body)',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': {
        color: 'var(--bg-body)',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionMatchedText': {
        color: 'var(--bg-body)',
        textDecoration: 'underline',
      },
      '.cm-completionDetail': {
        color: 'var(--status-warn-bright)',
        marginLeft: '10px',
      },
      '.cm-tooltip.cm-tooltip-hover': {
        maxWidth: '360px',
        padding: '8px 10px',
        lineHeight: '1.5',
      },
    },
    { dark: true },
  );
}

export function createCodeMirrorEditorHost(options?: EditorHostOptions): EditorHost {
  const element = document.createElement('div');
  element.className = 'script-editor script-cm-editor';
  const listeners = new Set<(source: string) => void>();
  let suppressChange = false;
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    javascript(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    autocompletion({ override: [completionSource(options)] }),
    apiHover(),
    errorLineField,
    highlightActiveLine(),
    editorTheme(),
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletionOrFallback }])),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || suppressChange) return;
      const source = update.state.doc.toString();
      for (const listener of [...listeners]) listener(source);
    }),
  ];

  const view = new EditorView({
    parent: element,
    state: EditorState.create({ doc: '', extensions }),
  });

  return {
    element,
    getValue(): string {
      return view.state.doc.toString();
    },
    setValue(source: string): void {
      const current = view.state.doc.toString();
      if (current === source) return;
      suppressChange = true;
      try {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: source },
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        suppressChange = false;
      }
    },
    onChange(cb: (source: string) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    focus(): void {
      view.focus();
    },
    setErrorLine(line: number | null): void {
      view.dispatch({ effects: setErrorLineEffect.of(line) });
    },
    destroy(): void {
      listeners.clear();
      view.destroy();
      element.textContent = '';
    },
  };
}

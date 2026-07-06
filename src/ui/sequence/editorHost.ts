import type { ApiReferenceVarsStore } from './apiReference';

export interface EditorHost {
  readonly element: HTMLElement;
  getValue(): string;
  setValue(source: string): void;
  onChange(cb: (source: string) => void): () => void;
  focus(): void;
  setErrorLine(line: number | null): void;
  destroy(): void;
}

export interface EditorHostOptions {
  readonly varsStore?: ApiReferenceVarsStore;
}

export type EditorHostFactory = (options?: EditorHostOptions) => EditorHost;

export function createTextareaEditorHost(): EditorHost {
  const element = document.createElement('div');
  element.className = 'script-editor script-editor-textarea';
  const gutter = document.createElement('div');
  gutter.className = 'script-gutter';
  const textarea = document.createElement('textarea');
  textarea.className = 'script-textarea';
  textarea.spellcheck = false;
  textarea.wrap = 'off';
  element.append(gutter, textarea);

  const listeners = new Set<(source: string) => void>();

  function renderGutter(): void {
    const lineCount = textarea.value.split('\n').length;
    gutter.textContent = '';
    for (let i = 1; i <= lineCount; i += 1) {
      const d = document.createElement('div');
      d.textContent = String(i);
      gutter.appendChild(d);
    }
  }

  const onInput = (): void => {
    renderGutter();
    for (const listener of [...listeners]) listener(textarea.value);
  };
  const onScroll = (): void => {
    gutter.scrollTop = textarea.scrollTop;
  };
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('scroll', onScroll);
  renderGutter();

  return {
    element,
    getValue(): string {
      return textarea.value;
    },
    setValue(source: string): void {
      textarea.value = source;
      renderGutter();
    },
    onChange(cb: (source: string) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    focus(): void {
      textarea.focus();
    },
    setErrorLine(line: number | null): void {
      element.dataset.errorLine = line === null ? '' : String(line);
    },
    destroy(): void {
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('scroll', onScroll);
      listeners.clear();
      element.textContent = '';
    },
  };
}

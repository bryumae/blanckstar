// Shared drag behavior for the Script Console's two splitters (editor/output
// and the API-reference drawer divider). One implementation so drag feedback,
// clamping, and edge-case handling can't drift between them.
export interface SplitterDragOptions {
  // 'x' resizes along the horizontal axis (col-resize), 'y' along the
  // vertical axis (row-resize).
  readonly axis: 'x' | 'y';
  // Provides the reference rect the drag ratio is computed against.
  readonly container: HTMLElement;
  // Receives the clamped position ratio in [min, max] on every move.
  readonly onRatio: (ratio: number) => void;
  // Carries the 'is-resizing' class for the whole gesture so the highlight
  // doesn't flicker off when the pointer outruns the handle.
  readonly resizeTarget: HTMLElement;
  readonly min: number;
  readonly max: number;
}

export function attachSplitterDrag(handle: HTMLElement, opts: SplitterDragOptions): void {
  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    opts.resizeTarget.classList.add('is-resizing');
    const onMove = (move: MouseEvent): void => {
      // The button was released where we couldn't see it (outside the window,
      // under a native dialog): end the drag instead of resizing button-up.
      if (move.buttons === 0) {
        onUp();
        return;
      }
      const rect = opts.container.getBoundingClientRect();
      const size = opts.axis === 'x' ? rect.width : rect.height;
      if (size <= 0) return;
      const pos = opts.axis === 'x' ? move.clientX - rect.left : move.clientY - rect.top;
      opts.onRatio(Math.min(opts.max, Math.max(opts.min, pos / size)));
    };
    const onUp = (): void => {
      opts.resizeTarget.classList.remove('is-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

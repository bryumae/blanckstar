// Shared card-panel builder for the 12-col grid screens (Data, Ephemeris,
// Measurement Log) — see src/ui/data/data.css for the grid + `.data-card`
// styles this markup depends on.
export function card(
  spanClass: string,
  title: string,
): { el: HTMLDivElement; header: HTMLDivElement; body: HTMLDivElement } {
  const el = document.createElement('div');
  el.className = `data-card ${spanClass}`;
  const header = document.createElement('div');
  header.className = 'data-card-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'data-card-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);
  const body = document.createElement('div');
  body.className = 'data-card-body';
  el.append(header, body);
  return { el, header, body };
}

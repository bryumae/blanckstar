// App shell (mvp0_spec.md §7 intro, §2.1-2.3; docs/design/ header + nav rail
// reference). Owns: the 48px header (brand, UTC/MET clocks, warp control,
// beacon indicator, scenario badge), the 220px nav rail (screen switcher +
// system vitals), the scenario-picker start overlay, and the win/lose result
// overlays. The three primary screens are mounted by the caller into the
// content slots this module exposes — the shell never imports
// src/ui/telescope|sequence|data internals (repo rule 2 / phase-9 boundary).
import type { SimEvent, SimCommand } from '../../sim/messages';
import type { ScenarioSeed, WarpFactor, WinStats, FailureReason } from '../../sim/types';
import { WARP_FACTORS } from '../../sim/types';
import { fmtUtcClock, fmtMet, fmtKm, fmtKmPerS, fmtDegrees, fmtDuration } from './format';
import './shell.css';

export type ScreenId = 'telescope' | 'sequence' | 'data';

const SCREENS: readonly { id: ScreenId; label: string; sub: string; icon: string }[] = [
  { id: 'telescope', label: 'Telescope', sub: 'Outside view · identify · measure', icon: '◎' },
  { id: 'sequence', label: 'Sequence & Calc', sub: 'Scripts · calculator · predictor', icon: '▸' },
  { id: 'data', label: 'Data', sub: 'Radio · ship · burns · time · log', icon: '▤' },
];

const WARP_LABELS: Readonly<Record<WarpFactor, string>> = {
  0: '⏸',
  1: '1×',
  10: '10×',
  100: '100×',
  1000: '1k',
  10000: '10k',
};

const FAILURE_TEXT: Readonly<Record<FailureReason, string>> = {
  'earth-atmosphere': 'Atmospheric burn-up — altitude dropped below 120 km above Earth.',
  'moon-collision': 'Lunar surface impact.',
  'sun-collision': 'Destroyed within 2 solar radii of the Sun.',
};

export interface ShellDeps {
  readonly seeds: readonly ScenarioSeed[];
  /** Last-chosen seed id, if any (localStorage-backed, injected). */
  readonly getLastSeedId: () => string | null;
  readonly setLastSeedId: (id: string) => void;
  readonly send: (cmd: SimCommand) => void;
  readonly addSimListener: (cb: (e: SimEvent) => void) => void;
  readonly removeSimListener: (cb: (e: SimEvent) => void) => void;
  /** Called once with the chosen seed to (re)initialize the sim. */
  readonly onInit: (seed: ScenarioSeed) => void;
  /** Called before switching to a screen so hosts can pause/resume rAF loops. */
  readonly onScreenVisibility?: (id: ScreenId, visible: boolean) => void;
}

export interface ShellHandle {
  /** Content element for a given screen — mount the real screen module here. */
  screenRoot(id: ScreenId): HTMLElement;
  destroy(): void;
}

export function mountShell(root: HTMLElement, deps: ShellDeps): ShellHandle {
  root.textContent = '';
  const app = document.createElement('div');
  app.id = 'app-shell';

  // ---- header ----
  const header = document.createElement('header');
  header.className = 'shell-header';

  const brand = document.createElement('div');
  brand.className = 'shell-brand';
  brand.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9.2" stroke="#4cc9e0" stroke-width="1.4"></circle>' +
    '<circle cx="12" cy="12" r="2.1" fill="#4cc9e0"></circle>' +
    '<path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4" stroke="#4cc9e0" stroke-width="1.4" stroke-linecap="round"></path>' +
    '</svg>';
  const brandText = document.createElement('div');
  const brandName = document.createElement('div');
  brandName.className = 'shell-brand-name';
  brandName.textContent = 'BLANCKSTAR';
  const brandSub = document.createElement('div');
  brandSub.className = 'shell-brand-sub';
  brandSub.textContent = 'EBC · BACKUP COMPUTER';
  brandText.append(brandName, brandSub);
  brand.appendChild(brandText);

  const clocks = document.createElement('div');
  clocks.className = 'shell-clocks';
  const utcBlock = clockBlock('MISSION TIME · UTC', false);
  const metBlock = clockBlock('MISSION ELAPSED', true);
  clocks.append(utcBlock.el, metBlock.el);

  const warp = document.createElement('div');
  warp.className = 'shell-warp';
  const warpLabel = document.createElement('div');
  warpLabel.className = 'shell-warp-label';
  warpLabel.textContent = 'TIME WARP';
  const warpGroup = document.createElement('div');
  warpGroup.className = 'shell-warp-group';
  const warpButtons = new Map<WarpFactor, HTMLButtonElement>();
  for (const factor of WARP_FACTORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shell-warp-btn';
    btn.textContent = WARP_LABELS[factor];
    btn.addEventListener('click', () => deps.send({ type: 'setWarp', factor }));
    warpGroup.appendChild(btn);
    warpButtons.set(factor, btn);
  }
  warp.append(warpLabel, warpGroup);

  const status = document.createElement('div');
  status.className = 'shell-status';
  const beacon = document.createElement('div');
  beacon.className = 'shell-beacon';
  const beaconDot = document.createElement('span');
  beaconDot.className = 'shell-beacon-dot';
  const beaconText = document.createElement('span');
  beaconText.textContent = 'Earth beacon ';
  const beaconState = document.createElement('b');
  beaconState.className = 'shell-beacon-state';
  beaconState.textContent = 'NO LOCK';
  beaconText.appendChild(beaconState);
  beacon.append(beaconDot, beaconText);

  const scenarioBadge = document.createElement('div');
  scenarioBadge.className = 'shell-scenario-badge';
  const scenarioTag = document.createElement('span');
  scenarioTag.className = 'shell-scenario-tag';
  scenarioTag.textContent = 'SCENARIO';
  const scenarioTitle = document.createElement('span');
  scenarioTitle.className = 'shell-scenario-title';
  scenarioTitle.textContent = '—';
  scenarioBadge.append(scenarioTag, scenarioTitle);

  status.append(beacon, scenarioBadge);
  header.append(brand, clocks, warp, status);

  // ---- nav rail ----
  const rail = document.createElement('nav');
  rail.className = 'shell-rail';
  const railHeading = document.createElement('div');
  railHeading.className = 'shell-rail-heading';
  railHeading.textContent = 'PRIMARY SCREENS';
  rail.appendChild(railHeading);

  const navButtons = new Map<ScreenId, HTMLButtonElement>();
  for (const s of SCREENS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shell-nav-btn';
    const icon = document.createElement('span');
    icon.className = 'shell-nav-icon';
    icon.textContent = s.icon;
    const text = document.createElement('span');
    text.className = 'shell-nav-text';
    const label = document.createElement('span');
    label.className = 'shell-nav-label';
    label.textContent = s.label;
    const sub = document.createElement('span');
    sub.className = 'shell-nav-sub';
    sub.textContent = s.sub;
    text.append(label, sub);
    const dot = document.createElement('span');
    dot.className = 'shell-nav-dot';
    btn.append(icon, text, dot);
    btn.addEventListener('click', () => selectScreen(s.id));
    rail.appendChild(btn);
    navButtons.set(s.id, btn);
  }

  const vitals = document.createElement('div');
  vitals.className = 'shell-vitals';
  const vitalsHeading = document.createElement('div');
  vitalsHeading.className = 'shell-vitals-heading';
  vitalsHeading.textContent = 'SYSTEM VITALS';
  vitals.appendChild(vitalsHeading);
  const vitalEngine = vitalRow(vitals, 'Engine');
  const vitalDeltaV = vitalRow(vitals, 'Δv spent');
  const vitalMaxAccel = vitalRow(vitals, 'Max accel');
  const vitalBeacon = vitalRow(vitals, 'Beacon');
  const vitalSimMode = vitalRow(vitals, 'Sim mode');
  rail.appendChild(vitals);

  // ---- content ----
  const content = document.createElement('div');
  content.className = 'shell-content';
  const screenRoots = new Map<ScreenId, HTMLElement>();
  for (const s of SCREENS) {
    const el = document.createElement('section');
    el.className = 'shell-screen';
    el.id = `screen-${s.id}`;
    content.appendChild(el);
    screenRoots.set(s.id, el);
  }

  app.append(header, rail, content);
  root.appendChild(app);

  // ---- screen switching ----
  let activeScreen: ScreenId = 'telescope';
  function selectScreen(id: ScreenId): void {
    if (id === activeScreen) return;
    const prev = activeScreen;
    activeScreen = id;
    render();
    deps.onScreenVisibility?.(prev, false);
    deps.onScreenVisibility?.(id, true);
  }
  function render(): void {
    for (const s of SCREENS) {
      const isActive = s.id === activeScreen;
      screenRoots.get(s.id)!.classList.toggle('is-active', isActive);
      navButtons.get(s.id)!.classList.toggle('is-active', isActive);
    }
  }
  render();
  deps.onScreenVisibility?.(activeScreen, true);

  // ---- scenario picker overlay ----
  let beaconLocked = false;
  let overlayEl: HTMLElement | null = null;

  function closeOverlay(): void {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function showScenarioPicker(): void {
    closeOverlay();
    const lastId = deps.getLastSeedId();
    let selected: ScenarioSeed = deps.seeds.find((s) => s.id === lastId) ?? deps.seeds[0]!;

    const overlay = document.createElement('div');
    overlay.className = 'shell-overlay';
    const panel = document.createElement('div');
    panel.className = 'shell-overlay-panel';
    const title = document.createElement('div');
    title.className = 'shell-overlay-title';
    title.textContent = 'SELECT SCENARIO';
    const subtitle = document.createElement('div');
    subtitle.className = 'shell-overlay-subtitle';
    subtitle.textContent = 'Emergency backup computer — choose a starting scenario.';

    const cards = document.createElement('div');
    cards.className = 'shell-seed-cards';
    const cardEls = new Map<string, HTMLButtonElement>();
    for (const seed of deps.seeds) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shell-seed-card';
      const t = document.createElement('div');
      t.className = 'shell-seed-title';
      t.textContent = seed.title;
      const d = document.createElement('div');
      d.className = 'shell-seed-desc';
      d.textContent = seed.playerDescription;
      card.append(t, d);
      card.addEventListener('click', () => {
        selected = seed;
        for (const [id, el] of cardEls) el.classList.toggle('is-selected', id === seed.id);
      });
      cards.appendChild(card);
      cardEls.set(seed.id, card);
    }
    cardEls.get(selected.id)?.classList.add('is-selected');

    const actions = document.createElement('div');
    actions.className = 'shell-overlay-actions';
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'shell-btn is-primary';
    startBtn.textContent = 'Start mission';
    startBtn.addEventListener('click', () => {
      deps.setLastSeedId(selected.id);
      startSeed(selected);
      closeOverlay();
    });
    actions.appendChild(startBtn);

    panel.append(title, subtitle, cards, actions);
    overlay.appendChild(panel);
    root.appendChild(overlay);
    overlayEl = overlay;
  }

  function startSeed(seed: ScenarioSeed): void {
    beaconLocked = false;
    scenarioTitle.textContent = seed.title.toUpperCase();
    vitalMaxAccel.textContent = `${(seed.maxAcceleration ?? 0.5).toFixed(2)} m/s²`;
    deps.onInit(seed);
  }

  // ---- result / failure overlays ----
  function showWon(stats: WinStats): void {
    closeOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'shell-overlay';
    const panel = document.createElement('div');
    panel.className = 'shell-overlay-panel shell-result-panel';

    const headline = document.createElement('div');
    headline.className = 'shell-result-headline is-win';
    headline.textContent = 'TEMPORARY EARTH CAPTURE ACHIEVED';
    const reason = document.createElement('div');
    reason.className = 'shell-result-reason';
    reason.textContent = 'The ship is bound to Earth. Mission complete.';

    const statsGrid = document.createElement('div');
    statsGrid.className = 'shell-result-stats';
    addStat(statsGrid, 'Elapsed mission time', fmtDuration(stats.missionElapsed));
    addStat(statsGrid, 'Δv spent', fmtKmPerS(stats.deltaVSpent));
    addStat(statsGrid, 'Periapsis (center distance)', fmtKm(stats.orbit.periapsis));
    addStat(
      statsGrid,
      'Apoapsis (center distance)',
      Number.isFinite(stats.orbit.apoapsis) ? fmtKm(stats.orbit.apoapsis) : 'unbound',
    );
    addStat(statsGrid, 'Eccentricity', stats.orbit.eccentricity.toFixed(4));
    addStat(statsGrid, 'Inclination', fmtDegrees(stats.orbit.inclination));
    addStat(statsGrid, 'Period', stats.orbit.period !== null ? fmtDuration(stats.orbit.period) : '—');

    panel.append(headline, reason, statsGrid, restartActions());
    overlay.appendChild(panel);
    root.appendChild(overlay);
    overlayEl = overlay;
  }

  function showLost(reason: FailureReason): void {
    closeOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'shell-overlay';
    const panel = document.createElement('div');
    panel.className = 'shell-overlay-panel shell-result-panel';

    const headline = document.createElement('div');
    headline.className = 'shell-result-headline is-lose';
    headline.textContent = 'MISSION FAILED';
    const reasonEl = document.createElement('div');
    reasonEl.className = 'shell-result-reason';
    reasonEl.textContent = FAILURE_TEXT[reason];

    panel.append(headline, reasonEl, restartActions());
    overlay.appendChild(panel);
    root.appendChild(overlay);
    overlayEl = overlay;
  }

  function restartActions(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'shell-overlay-actions';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'shell-btn is-primary';
    retryBtn.textContent = 'Retry same seed';
    retryBtn.addEventListener('click', () => {
      beaconLocked = false;
      deps.send({ type: 'reset' });
      closeOverlay();
    });
    const otherBtn = document.createElement('button');
    otherBtn.type = 'button';
    otherBtn.className = 'shell-btn';
    otherBtn.textContent = 'Choose another seed';
    otherBtn.addEventListener('click', () => {
      showScenarioPicker();
    });
    actions.append(retryBtn, otherBtn);
    return actions;
  }

  function addStat(grid: HTMLElement, key: string, value: string): void {
    const r = document.createElement('div');
    r.className = 'shell-result-stat-row';
    const k = document.createElement('span');
    k.className = 'shell-result-stat-key';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'shell-result-stat-value';
    v.textContent = value;
    r.append(k, v);
    grid.appendChild(r);
  }

  // ---- sim event wiring ----
  const onSimEvent = (event: SimEvent): void => {
    switch (event.type) {
      case 'ready':
        beaconLocked = false;
        updateBeacon();
        break;
      case 'state':
        utcBlock.value.textContent = fmtUtcClock(event.simTime);
        metBlock.value.textContent = fmtMet(event.missionElapsed);
        for (const [factor, btn] of warpButtons) btn.classList.toggle('is-active', factor === event.warp);
        vitalEngine.textContent = event.ship.burning ? 'BURN' : 'idle';
        vitalDeltaV.textContent = fmtKmPerS(event.ship.deltaVSpent);
        vitalSimMode.textContent = event.warp === 0 ? 'paused' : `${event.warp}×`;
        break;
      case 'measurementAdded':
        if (event.measurement.data.kind === 'radioLock') {
          beaconLocked = true;
          updateBeacon();
        }
        break;
      case 'won':
        showWon(event.stats);
        break;
      case 'lost':
        showLost(event.reason);
        break;
    }
  };
  deps.addSimListener(onSimEvent);

  function updateBeacon(): void {
    beaconDot.classList.toggle('is-locked', beaconLocked);
    beaconState.classList.toggle('is-locked', beaconLocked);
    beaconState.textContent = beaconLocked ? 'LOCKED' : 'NO LOCK';
  }

  vitalMaxAccel.textContent = '0.5 m/s²';

  // Show the scenario picker on mount (spec §2: minimal start flow).
  showScenarioPicker();

  return {
    screenRoot(id: ScreenId): HTMLElement {
      return screenRoots.get(id)!;
    },
    destroy(): void {
      deps.removeSimListener(onSimEvent);
      closeOverlay();
      root.textContent = '';
    },
  };

  function clockBlock(labelText: string, isMet: boolean): { el: HTMLElement; value: HTMLElement } {
    const el = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'shell-clock-label';
    label.textContent = labelText;
    const value = document.createElement('div');
    value.className = isMet ? 'shell-clock-value is-met' : 'shell-clock-value';
    value.textContent = isMet ? 'MET +0d 00:00:00' : '—';
    el.append(label, value);
    return { el, value };
  }

  function vitalRow(parent: HTMLElement, keyText: string): HTMLElement {
    const r = document.createElement('div');
    r.className = 'shell-vital-row';
    const k = document.createElement('span');
    k.className = 'shell-vital-key';
    k.textContent = keyText;
    const v = document.createElement('span');
    v.className = 'shell-vital-value';
    v.textContent = '—';
    r.append(k, v);
    parent.appendChild(r);
    return v;
  }
}

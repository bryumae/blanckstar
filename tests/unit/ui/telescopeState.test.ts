import { describe, expect, it } from 'vitest';
import {
  addIdentified,
  canMeasureSeparation,
  createInitialState,
  setSepSelection,
  withFov,
  withMode,
  withSeparationLogged,
  withSeparationResult,
} from '../../../src/ui/telescope/state';

describe('createInitialState', () => {
  it('starts in outside mode with no identified objects', () => {
    const s = createInitialState();
    expect(s.mode).toBe('outside');
    expect(s.identified).toEqual([]);
    expect(s.sepA).toBeNull();
    expect(s.sepB).toBeNull();
  });
});

describe('addIdentified', () => {
  it('appends a new object', () => {
    const s = addIdentified(createInitialState(), { kind: 'body', id: 'earth', name: 'Earth', bodyId: 'earth' });
    expect(s.identified).toHaveLength(1);
    expect(s.identified[0]!.id).toBe('earth');
  });

  it('deduplicates by id (idempotent re-identify)', () => {
    let s = createInitialState();
    s = addIdentified(s, { kind: 'body', id: 'earth', name: 'Earth', bodyId: 'earth' });
    s = addIdentified(s, { kind: 'body', id: 'earth', name: 'Earth', bodyId: 'earth' });
    expect(s.identified).toHaveLength(1);
  });

  it('preserves referential stability when the object is already present', () => {
    let s = createInitialState();
    s = addIdentified(s, { kind: 'star', id: 'star:0', name: 'Vega' });
    const again = addIdentified(s, { kind: 'star', id: 'star:0', name: 'Vega' });
    expect(again).toBe(s);
  });
});

describe('separation selection + measurability', () => {
  it('is not measurable with fewer than two distinct selections', () => {
    let s = createInitialState();
    expect(canMeasureSeparation(s)).toBe(false);
    s = setSepSelection(s, 'A', 'earth');
    expect(canMeasureSeparation(s)).toBe(false);
  });

  it('becomes measurable once two distinct ids are selected', () => {
    let s = createInitialState();
    s = setSepSelection(s, 'A', 'earth');
    s = setSepSelection(s, 'B', 'mars');
    expect(canMeasureSeparation(s)).toBe(true);
  });

  it('is not measurable when both selections are the same id', () => {
    let s = createInitialState();
    s = setSepSelection(s, 'A', 'earth');
    s = setSepSelection(s, 'B', 'earth');
    expect(canMeasureSeparation(s)).toBe(false);
  });

  it('resets the last measurement when a selection changes', () => {
    let s = createInitialState();
    s = setSepSelection(s, 'A', 'earth');
    s = setSepSelection(s, 'B', 'mars');
    s = withSeparationResult(s, 1.2);
    s = withSeparationLogged(s);
    expect(s.lastSepRadians).toBe(1.2);
    expect(s.lastSepLogged).toBe(true);

    s = setSepSelection(s, 'B', 'venus');
    expect(s.lastSepRadians).toBeNull();
    expect(s.lastSepLogged).toBe(false);
  });
});

describe('withMode / withFov', () => {
  it('updates mode and fov independently', () => {
    let s = createInitialState();
    s = withMode(s, 'telescope');
    s = withFov(s, 5);
    expect(s.mode).toBe('telescope');
    expect(s.fovDeg).toBe(5);
  });
});

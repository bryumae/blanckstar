import { describe, expect, it } from 'vitest';
import { isDebugEnabled } from '../../src/ui/debug/gate';

describe('isDebugEnabled (§10)', () => {
  it('is false when not a dev build, regardless of the query param', () => {
    expect(isDebugEnabled('?debug=1', false)).toBe(false);
    expect(isDebugEnabled('', false)).toBe(false);
  });

  it('is false in dev without the query param', () => {
    expect(isDebugEnabled('', true)).toBe(false);
    expect(isDebugEnabled('?foo=1', true)).toBe(false);
  });

  it('is true only when dev AND ?debug=1', () => {
    expect(isDebugEnabled('?debug=1', true)).toBe(true);
    expect(isDebugEnabled('?other=x&debug=1', true)).toBe(true);
  });

  it('rejects any value other than exactly "1"', () => {
    expect(isDebugEnabled('?debug=true', true)).toBe(false);
    expect(isDebugEnabled('?debug=0', true)).toBe(false);
    expect(isDebugEnabled('?debug=', true)).toBe(false);
  });
});

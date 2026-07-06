export type SandboxVarValue =
  | null
  | boolean
  | number
  | string
  | readonly SandboxVarValue[]
  | { readonly [key: string]: SandboxVarValue };

export interface SandboxVarEntry {
  readonly name: string;
  readonly value: SandboxVarValue;
  readonly description: string;
  readonly modified: number;
}

export interface SandboxVarsSnapshot {
  readonly entries: readonly SandboxVarEntry[];
}

export interface CreateSandboxVarsDeps {
  readonly snapshot: SandboxVarsSnapshot;
  readonly reservedNames: ReadonlySet<string>;
  readonly totalSizeLimitBytes: number;
  readonly setVar: (name: string, value: SandboxVarValue) => void;
  readonly deleteVar: (name: string) => void;
}

export const SANDBOX_VAR_DESCRIPTION_LIMIT = 500;
export const SANDBOX_VAR_TOTAL_SIZE_LIMIT = 64 * 1024;
const PREDICTED_MODIFIED = 9_999_999_999_999;

export function validateSandboxVarName(name: string, reservedNames: ReadonlySet<string>): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`vars.${name} is not a valid variable name`);
  }
  if (name === 'vars' || reservedNames.has(name)) {
    throw new Error(`vars.${name} conflicts with a built-in API name`);
  }
}

export function validateSandboxVarValue(value: unknown): asserts value is SandboxVarValue {
  validateValue(value, new Set<object>(), 'value');
}

export function validateSandboxVarDescription(description: string): void {
  if (description.length > SANDBOX_VAR_DESCRIPTION_LIMIT) {
    throw new Error(`variable description must be ${SANDBOX_VAR_DESCRIPTION_LIMIT} characters or less`);
  }
}

export function serializedSandboxVarsSize(entries: readonly SandboxVarEntry[]): number {
  return new TextEncoder().encode(JSON.stringify({ entries })).length;
}

export function validateSandboxVarsTotalSize(
  entries: readonly SandboxVarEntry[],
  limitBytes: number,
  changedName: string,
): void {
  const bytes = serializedSandboxVarsSize(entries);
  if (bytes > limitBytes) {
    throw new Error(`vars.${changedName} exceeds the ${limitBytes} byte variable store limit`);
  }
}

export function snapshotValues(snapshot: SandboxVarsSnapshot): Record<string, SandboxVarValue> {
  const values = Object.create(null) as Record<string, SandboxVarValue>;
  for (const entry of snapshot.entries) {
    values[entry.name] = cloneSandboxVarValue(entry.value);
  }
  return values;
}

export function cloneSandboxVarValue(value: SandboxVarValue): SandboxVarValue {
  if (Array.isArray(value)) return value.map((v) => cloneSandboxVarValue(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, SandboxVarValue> = {};
    for (const [key, v] of Object.entries(value)) out[key] = cloneSandboxVarValue(v);
    return out;
  }
  return value;
}

export function createSandboxVarsProxy(deps: CreateSandboxVarsDeps): Record<string, SandboxVarValue> {
  const cache = snapshotValues(deps.snapshot);
  const metadata = new Map<string, Pick<SandboxVarEntry, 'description' | 'modified'>>();
  for (const entry of deps.snapshot.entries) {
    metadata.set(entry.name, { description: entry.description, modified: entry.modified });
  }

  function entriesWith(name: string, value: SandboxVarValue): SandboxVarEntry[] {
    const nextMetadata = metadata.get(name) ?? { description: '', modified: PREDICTED_MODIFIED };
    const names = new Set([...Object.keys(cache), name]);
    return [...names].map((entryName) => ({
      name: entryName,
      value: entryName === name ? value : cache[entryName]!,
      description: entryName === name ? nextMetadata.description : metadata.get(entryName)?.description ?? '',
      modified: entryName === name ? PREDICTED_MODIFIED : metadata.get(entryName)?.modified ?? PREDICTED_MODIFIED,
    }));
  }

  function upsertLocal(name: string, value: SandboxVarValue): void {
    const next = entriesWith(name, value);
    validateSandboxVarsTotalSize(next, deps.totalSizeLimitBytes, name);
    cache[name] = cloneSandboxVarValue(value);
    metadata.set(name, {
      description: metadata.get(name)?.description ?? '',
      modified: PREDICTED_MODIFIED,
    });
  }

  return new Proxy(cache, {
    get(target, prop) {
      if (typeof prop !== 'string') return Reflect.get(target, prop);
      return target[prop];
    },
    set(_target, prop, value) {
      if (typeof prop !== 'string') {
        throw new Error('vars only supports string property names');
      }
      validateSandboxVarName(prop, deps.reservedNames);
      validateSandboxVarValue(value);
      const cloned = cloneSandboxVarValue(value);
      upsertLocal(prop, cloned);
      deps.setVar(prop, cloned);
      return true;
    },
    deleteProperty(target, prop) {
      if (typeof prop !== 'string') return false;
      validateSandboxVarName(prop, deps.reservedNames);
      delete target[prop];
      metadata.delete(prop);
      deps.deleteVar(prop);
      return true;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(target, prop)) {
        return { enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
}

function validateValue(value: unknown, seen: Set<object>, path: string): void {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
    return;
  }
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new Error(`${path} is not JSON-safe; use delete for undefined`);
  }
  if (typeof value !== 'object') {
    throw new Error(`${path} is not JSON-safe`);
  }
  if (seen.has(value)) throw new Error(`${path} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateValue(item, seen, `${path}[${index}]`));
    seen.delete(value);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${path} must be a plain object`);
  }
  for (const [key, child] of Object.entries(value)) {
    validateValue(child, seen, `${path}.${key}`);
  }
  seen.delete(value);
}

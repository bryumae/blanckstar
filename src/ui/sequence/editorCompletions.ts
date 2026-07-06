import {
  FORBIDDEN_API_NAMES,
  SANDBOX_API_DOCS,
  type SandboxApiDoc,
  type SandboxFunctionDoc,
  type SandboxVariableDoc,
} from '../../sandbox/apiDocs';
import type { ApiReferenceVarsStore } from './apiReference';

export interface ScriptCompletionEntry {
  readonly label: string;
  readonly apply: string;
  readonly displayLabel?: string;
  readonly detail: string;
  readonly info: string;
  readonly type: 'constant' | 'function' | 'keyword' | 'method' | 'namespace' | 'variable';
  readonly section: 'API' | 'JavaScript' | 'Variables';
}

export interface ScriptCompletionContext {
  readonly objectName: string | null;
  readonly prefix: string;
  readonly varsStore?: ApiReferenceVarsStore;
}

interface CompletionNode {
  doc?: SandboxApiDoc;
  children: Map<string, CompletionNode>;
}

const ROOT: CompletionNode = buildDocTree(SANDBOX_API_DOCS);

const JS_KEYWORDS: readonly ScriptCompletionEntry[] = [
  'await',
  'delete',
  'const',
  'let',
  'var',
  'if',
  'else',
  'for',
  'while',
  'do',
  'return',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'typeof',
  'instanceof',
  'in',
  'void',
  'null',
  'true',
  'false',
].map((label) => ({
  label,
  apply: label,
  detail: 'JavaScript',
  info: `${label}\n\nJavaScript keyword/operator.`,
  type: 'keyword',
  section: 'JavaScript',
}));

function buildDocTree(docs: readonly SandboxApiDoc[]): CompletionNode {
  const root: CompletionNode = { children: new Map() };
  for (const doc of docs) {
    let node = root;
    for (const part of doc.name.split('.')) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
    node.doc = doc;
  }
  return root;
}

function docDetail(doc: SandboxApiDoc): string {
  if (doc.kind === 'function') return doc.async ? 'async - use await' : 'sync';
  return doc.source === 'player' ? 'player variable' : 'constant';
}

function docType(doc: SandboxApiDoc): ScriptCompletionEntry['type'] {
  if (doc.kind === 'function') return doc.name.includes('.') ? 'method' : 'function';
  return doc.source === 'player' ? 'variable' : 'constant';
}

function docApply(doc: SandboxApiDoc, part: string): string {
  if (doc.kind === 'function') return `${part}(${doc.args ? '' : ')'}`;
  return part;
}

function docInfo(doc: SandboxApiDoc): string {
  if (doc.kind === 'function') {
    const asyncHint = doc.async ? `\n\nAsync: use await ${doc.name}(${doc.args}).` : '\n\nSynchronous: no await.';
    return `${doc.name}(${doc.args})\n\n${doc.description}${asyncHint}`;
  }
  return `${doc.name}\n\n${doc.value} - ${doc.description}`;
}

function childEntry(
  parentName: string | null,
  part: string,
  node: CompletionNode,
): ScriptCompletionEntry {
  const fullName = parentName ? `${parentName}.${part}` : part;
  if (!node.doc) {
    return {
      label: part,
      apply: part,
      displayLabel: fullName,
      detail: 'namespace',
      info: fullName,
      type: 'namespace',
      section: 'API',
    };
  }
  return {
    label: part,
    apply: docApply(node.doc, part),
    displayLabel: parentName ? fullName : undefined,
    detail: docDetail(node.doc),
    info: docInfo(node.doc),
    type: docType(node.doc),
    section: node.doc.source === 'player' ? 'Variables' : 'API',
  };
}

function playerVarEntries(varsStore: ApiReferenceVarsStore | undefined): ScriptCompletionEntry[] {
  return (
    varsStore?.list().map((entry): ScriptCompletionEntry => ({
      label: entry.name,
      apply: entry.name,
      displayLabel: `vars.${entry.name}`,
      detail: 'player variable',
      info: `vars.${entry.name}\n\n${entry.description || 'Persistent player variable.'}`,
      type: 'variable',
      section: 'Variables',
    })) ?? []
  );
}

function prefixMatches(entry: ScriptCompletionEntry, prefix: string): boolean {
  const q = prefix.toLowerCase();
  return (
    q === '' ||
    entry.label.toLowerCase().startsWith(q) ||
    (entry.displayLabel?.toLowerCase().startsWith(q) ?? false)
  );
}

export function scriptCompletionEntries(context: ScriptCompletionContext): ScriptCompletionEntry[] {
  const parent = context.objectName ? ROOT.children.get(context.objectName) : ROOT;
  if (context.objectName === 'vars') {
    return playerVarEntries(context.varsStore).filter((entry) => prefixMatches(entry, context.prefix));
  }
  if (!parent) return [];
  const apiEntries = [...parent.children.entries()]
    .map(([part, node]) => childEntry(context.objectName, part, node))
    .filter((entry) => prefixMatches(entry, context.prefix));
  const jsEntries = context.objectName === null ? JS_KEYWORDS.filter((entry) => prefixMatches(entry, context.prefix)) : [];
  return [...apiEntries, ...jsEntries]
    .sort((a, b) => (a.displayLabel ?? a.label).localeCompare(b.displayLabel ?? b.label));
}

export function sandboxDocForName(name: string): SandboxApiDoc | null {
  let node = ROOT;
  for (const part of name.split('.')) {
    const child = node.children.get(part);
    if (!child) return null;
    node = child;
  }
  return node.doc ?? null;
}

export function forbiddenCompletionNames(entries: readonly ScriptCompletionEntry[]): string[] {
  const labels = new Set(entries.flatMap((entry) => [entry.label, entry.displayLabel ?? '']));
  return FORBIDDEN_API_NAMES.filter((name) => labels.has(name) || labels.has(name.split('.').pop()!));
}

export function formatSandboxDoc(doc: SandboxApiDoc): string {
  if (doc.kind === 'function') return `${(doc as SandboxFunctionDoc).name}(${doc.args})`;
  const variable = doc as SandboxVariableDoc;
  return `${variable.name}: ${variable.value}`;
}

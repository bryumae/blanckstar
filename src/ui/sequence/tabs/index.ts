// Phase 8 barrel (mvp0_spec.md §7.6, §7.7): Calculator / Candidates /
// Trajectory Predictor tabs for the Sequence & Calculation screen. Registers
// through `registerSequenceTab` from the sibling `../index` seam — the
// orchestrator passes `createSequenceTabs(deps)` as `SequenceScreenDeps.extraTabs`
// without editing src/ui/sequence/index.ts.
import type { EphemerisData } from '../../../core/ephemerisTypes';
import type { StorageLike } from '../../../net/storage';
import type { CandidateStore } from '../../candidateStore';
import type { Measurement } from '../../../sim/types';
import { registerSequenceTab, type SequenceTab } from '../index';
import { mountCalculatorTab } from './calculatorTab';
import { mountCandidatesTab } from './candidatesTab';
import { mountPredictorTab } from './predictorTab';
import './tabs.css';

export interface SequenceTabsDeps {
  readonly ephemeris: EphemerisData;
  readonly storage: StorageLike;
  readonly candidates: CandidateStore;
  readonly getMeasurements: () => readonly Measurement[];
  readonly exportText?: (filename: string, text: string) => void;
  readonly importText?: () => Promise<string | null>;
}

function defaultExportText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function defaultImportText(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'text/plain,.txt';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    input.click();
  });
}

export function createSequenceTabs(deps: SequenceTabsDeps): readonly SequenceTab[] {
  const exportText = deps.exportText ?? defaultExportText;
  const importText = deps.importText ?? defaultImportText;

  return [
    registerSequenceTab('calculator', 'Calculator', (root) => mountCalculatorTab(root)),
    registerSequenceTab('candidates', 'Candidates', (root) =>
      mountCandidatesTab(root, {
        ephemeris: deps.ephemeris,
        storage: deps.storage,
        candidates: deps.candidates,
        getMeasurements: deps.getMeasurements,
        exportText,
        importText,
      }),
    ),
    registerSequenceTab('predictor', 'Trajectory Predictor', (root) =>
      mountPredictorTab(root, { ephemeris: deps.ephemeris, candidates: deps.candidates }),
    ),
  ];
}

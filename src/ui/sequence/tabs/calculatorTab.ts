// Calculator tab DOM (mvp0_spec.md §7.6): operation picker, vector A (cyan) /
// vector B (purple) inputs, scalar input, mono result box, deg<->rad display
// toggle, and an SI constants reference table. All compute logic lives in
// ./calculator.ts; this module is DOM wiring only.
import type { Vector3 } from '../../../core/vector3';
import { C, MU_SUN, MU_EARTH, MU_MOON, R_EARTH, R_MOON, R_SOI_EARTH, AU, SHIP_MASS_KG } from '../../../core/constants';
import { CALC_OPERATIONS, calcOperationInfo, evaluateCalc, radToDeg, degToRad, type CalcOperation } from './calculator';

const CONSTANTS: readonly { readonly k: string; readonly v: string }[] = [
  { k: 'C', v: `${C.toExponential(3)} m/s` },
  { k: 'MU_SUN', v: MU_SUN.toExponential(3) },
  { k: 'MU_EARTH', v: MU_EARTH.toExponential(3) },
  { k: 'MU_MOON', v: MU_MOON.toExponential(3) },
  { k: 'R_EARTH', v: `${R_EARTH.toExponential(3)} m` },
  { k: 'R_MOON', v: `${R_MOON.toExponential(3)} m` },
  { k: 'R_SOI_EARTH', v: `${R_SOI_EARTH.toExponential(3)} m` },
  { k: 'AU', v: `${AU.toExponential(3)} m` },
  { k: 'SHIP_MASS_KG', v: SHIP_MASS_KG.toLocaleString('en-US') },
];

function parseNum(input: HTMLInputElement): number {
  const v = parseFloat(input.value);
  return Number.isFinite(v) ? v : 0;
}

export function mountCalculatorTab(root: HTMLElement): void {
  root.className = 'calc-tab';

  const left = document.createElement('div');
  left.className = 'panel';
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = 'VECTOR / SCALAR CALCULATOR';
  left.appendChild(title);

  const opLabel = document.createElement('label');
  opLabel.className = 'micro';
  opLabel.textContent = 'OPERATION';
  const opSelect = document.createElement('select');
  for (const op of CALC_OPERATIONS) {
    const opt = document.createElement('option');
    opt.value = op.id;
    opt.textContent = op.label;
    opSelect.appendChild(opt);
  }
  left.append(opLabel, opSelect);

  function makeVecRow(labelText: string, cls: 'a' | 'b'): { row: HTMLDivElement; inputs: [HTMLInputElement, HTMLInputElement, HTMLInputElement] } {
    const row = document.createElement('div');
    row.className = 'calc-row';
    const label = document.createElement('span');
    label.className = `vec-label ${cls}`;
    label.textContent = labelText;
    const inputs = [0, 1, 2].map(() => {
      const inp = document.createElement('input');
      inp.className = 'calc-input';
      inp.type = 'text';
      inp.value = '0';
      inp.inputMode = 'decimal';
      return inp;
    }) as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
    row.append(label, ...inputs);
    return { row, inputs };
  }

  const vecA = makeVecRow('A', 'a');
  const vecB = makeVecRow('B', 'b');
  left.append(vecA.row, vecB.row);

  const scalarRow = document.createElement('div');
  scalarRow.className = 'calc-row';
  const scalarLabel = document.createElement('span');
  scalarLabel.className = 'vec-label';
  scalarLabel.textContent = 's';
  const scalarInput = document.createElement('input');
  scalarInput.className = 'calc-input';
  scalarInput.type = 'text';
  scalarInput.value = '0';
  const scalarBInput = document.createElement('input');
  scalarBInput.className = 'calc-input';
  scalarBInput.type = 'text';
  scalarBInput.value = '0';
  scalarBInput.title = 'second scalar argument (atan2 only)';
  scalarRow.append(scalarLabel, scalarInput, scalarBInput);
  left.append(scalarRow);

  const resultBox = document.createElement('div');
  resultBox.className = 'calc-result-box';
  const resultLabel = document.createElement('div');
  resultLabel.className = 'label';
  resultLabel.textContent = 'RESULT';
  const resultValue = document.createElement('div');
  resultValue.className = 'calc-result-value';
  resultBox.append(resultLabel, resultValue);
  left.appendChild(resultBox);

  const degToggleWrap = document.createElement('label');
  degToggleWrap.className = 'calc-deg-toggle';
  const degToggle = document.createElement('input');
  degToggle.type = 'checkbox';
  const degToggleText = document.createElement('span');
  degToggleText.textContent = 'display angles in degrees';
  degToggleWrap.append(degToggle, degToggleText);
  left.appendChild(degToggleWrap);

  const right = document.createElement('div');
  right.className = 'panel';
  const constTitle = document.createElement('div');
  constTitle.className = 'panel-title';
  constTitle.textContent = 'CONSTANTS · SI';
  right.appendChild(constTitle);
  for (const c of CONSTANTS) {
    const row = document.createElement('div');
    row.className = 'calc-const-row';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = c.k;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = c.v;
    row.append(k, v);
    right.appendChild(row);
  }

  root.append(left, right);

  // Ops whose result is an angle in radians (so the deg/rad toggle applies).
  const ANGLE_OPS = new Set<CalcOperation>(['angleBetween', 'asin', 'acos', 'atan2']);
  const ANGLE_INPUT_OPS = new Set<CalcOperation>(['sin', 'cos', 'tan']);

  function readVec(inputs: readonly [HTMLInputElement, HTMLInputElement, HTMLInputElement]): Vector3 {
    return { x: parseNum(inputs[0]), y: parseNum(inputs[1]), z: parseNum(inputs[2]) };
  }

  function recompute(): void {
    const op = opSelect.value as CalcOperation;
    const info = calcOperationInfo(op);
    vecA.row.style.display = info.usesA ? 'flex' : 'none';
    vecB.row.style.display = info.usesB ? 'flex' : 'none';
    scalarRow.style.display = info.usesScalar ? 'flex' : 'none';
    scalarBInput.style.display = op === 'atan2' ? '' : 'none';

    const a = readVec(vecA.inputs);
    const b = readVec(vecB.inputs);
    let scalar = parseNum(scalarInput);
    if (ANGLE_INPUT_OPS.has(op) && degToggle.checked) {
      scalar = degToRad(scalar);
    }
    const scalarB = parseNum(scalarBInput);

    const result = evaluateCalc(op, a, b, scalar, scalarB);
    if (result.kind === 'vector') {
      resultValue.textContent = `(${result.value.x.toPrecision(6)}, ${result.value.y.toPrecision(6)}, ${result.value.z.toPrecision(6)})`;
    } else {
      const display = ANGLE_OPS.has(op) && degToggle.checked ? radToDeg(result.value) : result.value;
      const suffix = ANGLE_OPS.has(op) && degToggle.checked ? '°' : '';
      resultValue.textContent = `${display.toPrecision(8)}${suffix}`;
    }
  }

  opSelect.addEventListener('change', recompute);
  degToggle.addEventListener('change', recompute);
  for (const inp of [...vecA.inputs, ...vecB.inputs, scalarInput, scalarBInput]) {
    inp.addEventListener('input', recompute);
  }

  recompute();
}

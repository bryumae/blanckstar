// Rolling trajectory-trace buffer for the debug map (mvp0_spec.md §10).
// Client-side only: every state frame's ship position is pushed, oldest
// dropped once the buffer is full. Kept as a plain class (not a functional
// reducer) since it's a fixed-capacity ring used purely for rendering, not
// something whose history needs to be diffed/tested by comparing snapshots.
import type { Vector3 } from '../../core/vector3';

export class TrajectoryTrace {
  private readonly buffer: Vector3[] = [];

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error('TrajectoryTrace: capacity must be positive');
    }
  }

  push(position: Vector3): void {
    this.buffer.push(position);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  points(): readonly Vector3[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

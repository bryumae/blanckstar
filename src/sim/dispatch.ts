// Command dispatch (mvp0_spec.md §3): maps a typed SimCommand onto the
// Simulation + WarpDriver. Kept separate from worker.ts so the whole
// command->event path is testable through the injected emit seam without worker
// globals (ADR-0001). worker.ts is a thin shell that binds self.onmessage to
// this and self.postMessage to the sim's emit.
import { Simulation } from './simulation';
import { WarpDriver, type TickScheduler, type WallClock } from './driver';
import type { EmitFn, SimCommand } from './messages';

// A dispatcher bundling the sim and its warp driver. `handle` runs one command.
export class SimDispatcher {
  readonly sim: Simulation;
  private readonly driver: WarpDriver;

  constructor(emit: EmitFn, schedule: TickScheduler, now: WallClock) {
    this.sim = new Simulation(emit);
    this.driver = new WarpDriver(this.sim, schedule, now);
  }

  handle(command: SimCommand): void {
    switch (command.type) {
      case 'init':
        this.driver.stop();
        this.sim.init(command.ephemeris, command.seed);
        return;
      case 'reset':
        this.driver.stop();
        this.sim.reset(); // emits ready + state (like init)
        return;
      case 'setWarp':
        this.driver.setWarp(command.factor);
        return;
      case 'skipToTime':
        this.driver.stop();
        this.sim.skipToTime(command.targetTime);
        return;
      case 'point':
        this.sim.point(command.direction);
        return;
      case 'burn':
        this.sim.burn(command.throttle, command.duration);
        return;
      case 'scheduleBurn':
        this.sim.scheduleBurn(command.startTime, command.direction, command.throttle, command.duration);
        return;
      case 'cancelBurn':
        this.sim.cancelBurn(command.id);
        return;
      case 'radioLockEarth':
        this.sim.measureRadioLockEarth();
        return;
      case 'sunDirection':
        this.sim.measureSunDirection();
        return;
      case 'starAttitude':
        this.sim.measureStarAttitude();
        return;
      case 'angularSeparation':
        this.sim.measureAngularSeparation(command.bodyA, command.bodyB);
        return;
      case 'annotateMeasurement':
        this.sim.annotateMeasurement(command.id, command.note);
        return;
      case 'ephemerisQuery':
        this.sim.ephemerisQuery(command.requestId, command.body, command.t);
        return;
      case 'debugTeleport':
        // DEBUG-only (§10)
        this.sim.debugTeleport(command.position, command.velocity);
        return;
    }
  }
}

// Message protocol between main thread and the simulation worker (Worker #1,
// mvp0_spec.md §3, §4.4, §6). Kept minimal for the bootstrap roundtrip; the
// clock/tiered-timestep driver and instrument models land in later PRs.
export interface PingMessage {
  readonly type: 'ping';
}

export interface PongMessage {
  readonly type: 'pong';
}

export type SimWorkerMessage = PingMessage;
export type SimWorkerResponse = PongMessage;

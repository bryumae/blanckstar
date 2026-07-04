// Message protocol between main thread and the player-script sandbox worker
// (Worker #2, mvp0_spec.md §8). The injected API surface (ship/radio/sensors/
// ephemeris/etc.) and forbidden-API enforcement land in later PRs.
export interface PingMessage {
  readonly type: 'ping';
}

export interface PongMessage {
  readonly type: 'pong';
}

export type SandboxWorkerMessage = PingMessage;
export type SandboxWorkerResponse = PongMessage;

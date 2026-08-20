export type Direction = 'up' | 'down' | 'left' | 'right';
export type Role = 'guide' | 'runner';
export type Phase = 'intro' | 'playing' | 'success' | 'disconnected';
export type Position = { x: number; y: number };
export type Cell = { n: boolean; e: boolean; s: boolean; w: boolean };
export type Maze = { width: number; height: number; cells: Cell[][]; start: Position; exit: Position; seed: number };
export type Country = { code: string; name: string; city: string; lat: number; lon: number };
export type SafeMessage = 'thank-you' | 'that-was-fun' | 'we-made-it' | 'good-luck';
export type PublicStats = { waiting: number; completedToday: number };
export type MatchState = { roomId: string; role: Role; phase: Phase; maze: Maze; position: Position; introEndsAt: number; countries: [Country, Country]; distanceKm: number; finalMessages: Partial<Record<Role, SafeMessage>> };

export interface ServerToClientEvents {
  stats: (stats: PublicStats) => void;
  waiting: () => void;
  matched: (state: MatchState) => void;
  state: (state: MatchState) => void;
  signal: (payload: { direction: Direction; at: number }) => void;
  peerDisconnected: () => void;
  errorMessage: (message: string) => void;
}
export interface ClientToServerEvents {
  joinQueue: (payload: { countryCode: string }) => void;
  leaveQueue: () => void;
  move: (payload: { direction: Direction }) => void;
  signal: (payload: { direction: Direction }) => void;
  finalMessage: (payload: { message: SafeMessage }) => void;
  replay: () => void;
}

export const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
export const SAFE_MESSAGES: SafeMessage[] = ['thank-you', 'that-was-fun', 'we-made-it', 'good-luck'];
export const isDirection = (v: unknown): v is Direction => typeof v === 'string' && DIRECTIONS.includes(v as Direction);
export const isSafeMessage = (v: unknown): v is SafeMessage => typeof v === 'string' && SAFE_MESSAGES.includes(v as SafeMessage);
export * from './countries.js';
export * from './maze.js';

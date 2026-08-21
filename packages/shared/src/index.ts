export type Direction = 'up' | 'down' | 'left' | 'right';
export type Role = 'guide' | 'runner';
export type GameMode = 'maze' | 'draw' | 'howIsTheSoup';
export type Phase = 'selecting' | 'intro' | 'playing' | 'success' | 'drawing' | 'revealed' | 'soup' | 'disconnected';
export type Position = { x: number; y: number };
export type Cell = { n: boolean; e: boolean; s: boolean; w: boolean };
export type Maze = { width: number; height: number; cells: Cell[][]; start: Position; exit: Position; seed: number };
export type Country = { code: string; name: string; city: string; lat: number; lon: number };
export type SafeMessage = 'thank-you' | 'that-was-fun' | 'we-made-it' | 'good-luck';
export type DrawReaction = '✦' | '♡' | '☀' | '!' | '?';
export type PublicStats = { waiting: number; completedToday: number; activeRooms: number; records: import('./soup.js').SessionRecords };
export type MatchState = {
  roomId: string; role: Role; mode?: GameMode; phase: Phase; maze: Maze; position: Position;
  introEndsAt: number; countries: [Country, Country]; distanceKm: number;
  finalMessages: Partial<Record<Role, SafeMessage>>;
  topic?: string; drawEndsAt?: number; submitted?: boolean; mazeStartedAt?: number; mazeElapsedMs?: number;
  drawings?: Partial<Record<Role, string>>; reactions?: Partial<Record<Role, DrawReaction>>;
  soupSide?: import('./soup.js').SoupSide; soup?: import('./soup.js').SoupSnapshot;
};

export interface ServerToClientEvents {
  stats: (stats: PublicStats) => void;
  waiting: () => void;
  matched: (state: MatchState) => void;
  state: (state: MatchState) => void;
  signal: (payload: { direction: Direction; at: number }) => void;
  peerDisconnected: () => void;
  errorMessage: (message: string) => void;
  soupSnapshot: (snapshot: import('./soup.js').SoupSnapshot) => void;
}
export interface ClientToServerEvents {
  joinQueue: (payload: { countryCode: string }) => void;
  leaveQueue: () => void;
  selectGame: (payload: { mode: GameMode }) => void;
  move: (payload: { direction: Direction }) => void;
  signal: (payload: { direction: Direction }) => void;
  finalMessage: (payload: { message: SafeMessage }) => void;
  replay: () => void;
  submitDrawing: (payload: { image: string }) => void;
  reactDrawing: (payload: { reaction: DrawReaction }) => void;
  drawAgain: () => void;
  soupInput: (payload: import('./soup.js').SoupInput) => void;
  anotherBowl: () => void;
  chooseAnotherGame: () => void;
}

export const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
export const SAFE_MESSAGES: SafeMessage[] = ['thank-you', 'that-was-fun', 'we-made-it', 'good-luck'];
export const DRAW_REACTIONS: DrawReaction[] = ['✦', '♡', '☀', '!', '?'];
export const isDirection = (v: unknown): v is Direction => typeof v === 'string' && DIRECTIONS.includes(v as Direction);
export const isSafeMessage = (v: unknown): v is SafeMessage => typeof v === 'string' && SAFE_MESSAGES.includes(v as SafeMessage);
export const isGameMode = (v: unknown): v is GameMode => v === 'maze' || v === 'draw' || v === 'howIsTheSoup';
export const isDrawReaction = (v: unknown): v is DrawReaction => typeof v === 'string' && DRAW_REACTIONS.includes(v as DrawReaction);
export * from './countries.js';
export * from './maze.js';
export * from './soup.js';

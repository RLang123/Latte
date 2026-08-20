import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  countryByCode, distanceKm, generateMaze, movePosition, isDirection, isSafeMessage, isGameMode, isDrawReaction,
  type ClientToServerEvents, type Country, type DrawReaction, type GameMode, type MatchState, type Role, type ServerToClientEvents,
} from '@without-words/shared';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type Waiting = { socketId: string; country: Country; joinedAt: number };
type Room = {
  id: string; players: Record<Role, { socketId: string; country: Country }>;
  state: MatchState; choices: Partial<Record<Role, GameMode>>; drawings: Partial<Record<Role, string>>;
  reactions: Partial<Record<Role, DrawReaction>>; lastMove: number; lastSignal: number; drawTimer?: ReturnType<typeof setTimeout>;
};

const TOPICS = ['HOME', 'FREEDOM', 'HAPPINESS', 'LONELINESS', 'FRIENDSHIP', 'DREAM', 'THE FUTURE', 'A PERFECT DAY', 'SAFE PLACE', 'LOVE', 'FEAR', 'ADVENTURE'];
const MAX_DRAWING_LENGTH = 360_000;
const nextTopic = (previous?: string) => { const options = TOPICS.filter(topic => topic !== previous); return options[Math.floor(Math.random() * options.length)]; };

export class GameServer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  waiting: Waiting[] = [];
  rooms = new Map<string, Room>();
  socketRooms = new Map<string, string>();
  socketCountries = new Map<string, Country>();
  completedToday = 0;
  private roomNo = 0;

  constructor(server: HttpServer) { this.io = new Server(server, { cors: { origin: true, credentials: false } }); this.io.on('connection', s => this.connect(s)); }
  stats() { return { waiting: this.waiting.length, completedToday: this.completedToday }; }
  private broadcastStats() { this.io.emit('stats', this.stats()); }
  private connect(socket: GameSocket) {
    socket.emit('stats', this.stats());
    socket.on('joinQueue', p => this.join(socket, p)); socket.on('leaveQueue', () => this.leaveQueue(socket.id));
    socket.on('selectGame', p => this.selectGame(socket, p)); socket.on('move', p => this.move(socket, p)); socket.on('signal', p => this.signal(socket, p));
    socket.on('finalMessage', p => this.final(socket, p)); socket.on('replay', () => this.replay(socket));
    socket.on('submitDrawing', p => this.submitDrawing(socket, p)); socket.on('reactDrawing', p => this.reactDrawing(socket, p)); socket.on('drawAgain', () => this.drawAgain(socket));
    socket.on('disconnect', () => this.disconnect(socket));
  }
  private join(socket: GameSocket, p: { countryCode: string }) {
    if (this.socketRooms.has(socket.id) || this.waiting.some(w => w.socketId === socket.id)) return;
    const country = typeof p?.countryCode === 'string' && countryByCode(p.countryCode);
    if (!country) { socket.emit('errorMessage', 'Choose a valid country.'); return; }
    this.socketCountries.set(socket.id, country); this.waiting.push({ socketId: socket.id, country, joinedAt: Date.now() }); socket.emit('waiting'); this.match(); this.broadcastStats();
  }
  private match() {
    while (this.waiting.length >= 2) {
      const first = this.waiting[0]; let idx = this.waiting.findIndex((w, i) => i > 0 && w.country.code !== first.country.code); if (idx < 0) idx = 1;
      const second = this.waiting[idx]; this.waiting.splice(idx, 1); this.waiting.shift();
      if (!this.io.sockets.sockets.has(first.socketId) || !this.io.sockets.sockets.has(second.socketId)) continue;
      this.create(first, second);
    }
  }
  private create(a: Waiting, b: Waiting) {
    const id = `room-${Date.now().toString(36)}-${++this.roomNo}`, seed = (Date.now() ^ this.roomNo * 2654435761) >>> 0, maze = generateMaze(seed);
    const countries: [Country, Country] = [a.country, b.country];
    const state: MatchState = { roomId: id, role: 'guide', phase: 'selecting', maze, position: maze.start, introEndsAt: 0, countries, distanceKm: distanceKm(...countries), finalMessages: {} };
    const room: Room = { id, players: { guide: { socketId: a.socketId, country: a.country }, runner: { socketId: b.socketId, country: b.country } }, state, choices: {}, drawings: {}, reactions: {}, lastMove: 0, lastSignal: 0 };
    this.rooms.set(id, room);
    for (const role of ['guide', 'runner'] as Role[]) { const s = this.io.sockets.sockets.get(room.players[role].socketId); if (s) { s.join(id); this.socketRooms.set(s.id, id); s.emit('matched', { ...state, role }); } }
  }
  private roomFor(socket: GameSocket) { const id = this.socketRooms.get(socket.id); return id ? this.rooms.get(id) : undefined; }
  private role(room: Room, id: string): Role | undefined { return room.players.guide.socketId === id ? 'guide' : room.players.runner.socketId === id ? 'runner' : undefined; }
  private stateFor(room: Room, role: Role): MatchState {
    const state: MatchState = { ...room.state, role, submitted: Boolean(room.drawings[role]), reactions: { ...room.reactions } };
    if (state.phase !== 'revealed') delete state.drawings; else state.drawings = { ...room.drawings };
    return state;
  }
  private emitState(room: Room) { for (const role of ['guide', 'runner'] as Role[]) this.io.to(room.players[role].socketId).emit('state', this.stateFor(room, role)); }
  private selectGame(socket: GameSocket, p: { mode: unknown }) {
    const room = this.roomFor(socket), role = room && this.role(room, socket.id); if (!room || !role || room.state.phase !== 'selecting' || !isGameMode(p?.mode)) return;
    room.choices[role] = p.mode;
    if (!room.choices.guide || !room.choices.runner) return;
    if (room.choices.guide !== room.choices.runner) { room.choices = {}; this.emitState(room); socket.emit('errorMessage', 'Choose the same experiment as the other human.'); return; }
    const mode = room.choices.guide, introEndsAt = Date.now() + 3500;
    room.state.mode = mode; room.state.phase = 'intro'; room.state.introEndsAt = introEndsAt;
    if (mode === 'draw') { room.state.topic = nextTopic(); room.state.drawEndsAt = introEndsAt + 60_000; }
    this.emitState(room);
    setTimeout(() => { const r = this.rooms.get(room.id); if (!r || r.state.phase !== 'intro') return; r.state.phase = mode === 'draw' ? 'drawing' : 'playing'; this.emitState(r); if (mode === 'draw') this.startDrawTimer(r); }, Math.max(0, introEndsAt - Date.now()));
  }
  private startDrawTimer(room: Room) { if (room.drawTimer) clearTimeout(room.drawTimer); room.drawTimer = setTimeout(() => this.revealDrawings(room), Math.max(0, (room.state.drawEndsAt ?? Date.now()) - Date.now())); }
  private move(socket: GameSocket, p: { direction: unknown }) { const r = this.roomFor(socket); if (!r || r.state.mode !== 'maze' || this.role(r, socket.id) !== 'runner' || r.state.phase !== 'playing' || !isDirection(p?.direction)) return; const now = Date.now(); if (now - r.lastMove < 65) return; r.lastMove = now; const next = movePosition(r.state.maze, r.state.position, p.direction); if (next === r.state.position) return; r.state.position = next; if (next.x === r.state.maze.exit.x && next.y === r.state.maze.exit.y) { r.state.phase = 'success'; this.completedToday++; this.broadcastStats(); } this.emitState(r); }
  private signal(socket: GameSocket, p: { direction: unknown }) { const r = this.roomFor(socket); if (!r || r.state.mode !== 'maze' || this.role(r, socket.id) !== 'guide' || r.state.phase !== 'playing' || !isDirection(p?.direction)) return; const now = Date.now(); if (now - r.lastSignal < 400) return; r.lastSignal = now; this.io.to(r.players.runner.socketId).emit('signal', { direction: p.direction, at: now }); }
  private final(socket: GameSocket, p: { message: unknown }) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'maze' || r.state.phase !== 'success' || r.state.finalMessages[role] || !isSafeMessage(p?.message)) return; r.state.finalMessages[role] = p.message; this.emitState(r); }
  private submitDrawing(socket: GameSocket, p: { image: unknown }) {
    const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'draw' || r.state.phase !== 'drawing' || r.drawings[role] || typeof p?.image !== 'string') return;
    const valid = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.image) && p.image.length <= MAX_DRAWING_LENGTH;
    if (!valid) { socket.emit('errorMessage', 'Drawing is too large or invalid.'); return; }
    r.drawings[role] = p.image; this.emitState(r); if (r.drawings.guide && r.drawings.runner) this.revealDrawings(r);
  }
  private revealDrawings(room: Room) { if (room.state.phase !== 'drawing') return; if (room.drawTimer) clearTimeout(room.drawTimer); room.state.phase = 'revealed'; this.emitState(room); }
  private reactDrawing(socket: GameSocket, p: { reaction: unknown }) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'draw' || r.state.phase !== 'revealed' || r.reactions[role] || !isDrawReaction(p?.reaction)) return; r.reactions[role] = p.reaction; this.emitState(r); }
  private drawAgain(socket: GameSocket) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'draw' || r.state.phase !== 'revealed') return; r.drawings = {}; r.reactions = {}; r.state.topic = nextTopic(r.state.topic); r.state.phase = 'drawing'; r.state.drawEndsAt = Date.now() + 60_000; this.emitState(r); this.startDrawTimer(r); }
  private replay(socket: GameSocket) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); const country = role && r ? r.players[role].country : this.socketCountries.get(socket.id); if (!country) return; if (r) this.removeRoom(r); if (socket.connected) this.join(socket, { countryCode: country.code }); }
  private leaveQueue(id: string) { this.waiting = this.waiting.filter(w => w.socketId !== id); this.broadcastStats(); }
  private disconnect(socket: GameSocket) { this.leaveQueue(socket.id); const r = this.roomFor(socket); this.socketCountries.delete(socket.id); if (!r) return; const other = this.role(r, socket.id) === 'guide' ? r.players.runner.socketId : r.players.guide.socketId; this.io.to(other).emit('peerDisconnected'); this.removeRoom(r); }
  private removeRoom(r: Room) { if (r.drawTimer) clearTimeout(r.drawTimer); for (const role of ['guide', 'runner'] as Role[]) { this.socketRooms.delete(r.players[role].socketId); this.io.sockets.sockets.get(r.players[role].socketId)?.leave(r.id); } this.rooms.delete(r.id); }
  close() { return this.io.close(); }
}

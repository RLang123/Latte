import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  countryByCode, distanceKm, generateMaze, movePosition, isDirection, isSafeMessage, isGameMode, isDrawReaction, isWorldRegion,
  type ClientToServerEvents, type Country, type DrawReaction, type GameMode, type MatchState, type Role, type ServerToClientEvents, type WorldRegion, type WorldGame, type WorldData,
} from '@without-words/shared';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type Waiting = { socketId: string; country: Country; joinedAt: number };
type Room = {
  id: string; players: Record<Role, { socketId: string; country: Country }>;
  state: MatchState; choices: Partial<Record<Role, GameMode>>; drawings: Partial<Record<Role, string>>;
  reactions: Partial<Record<Role, DrawReaction>>; lastMove: number; lastSignal: number; drawTimer?: ReturnType<typeof setTimeout>;
  worldVotes: Partial<Record<Role, WorldRegion>>; worldReady: Partial<Record<Role, boolean>>; worldData?: WorldData; worldTimer?: ReturnType<typeof setTimeout>;
};

const TOPICS = ['HOME', 'FREEDOM', 'HAPPINESS', 'LONELINESS', 'FRIENDSHIP', 'DREAM', 'THE FUTURE', 'A PERFECT DAY', 'SAFE PLACE', 'LOVE', 'FEAR', 'ADVENTURE'];
const MAX_DRAWING_LENGTH = 360_000;
const nextTopic = (previous?: string) => { const options = TOPICS.filter(topic => topic !== previous); return options[Math.floor(Math.random() * options.length)]; };
const WORLD_GAMES: Record<WorldRegion, { game: WorldGame; title: string; country: string; area: string }> = {
  'east-asia': { game: 'yut-nori', title: 'YUT NORI', country: 'Korea', area: 'East Asia' },
  'south-asia': { game: 'pachisi-duel', title: 'PACHISI DUEL', country: 'India', area: 'South Asia' },
  'central-eurasia': { game: 'assyk-aim', title: 'ASSYK AIM', country: 'Kazakhstan', area: 'Central Eurasia' },
  africa: { game: 'oware', title: 'OWARE', country: 'Ghana', area: 'West Africa' },
  americas: { game: 'loteria-duo', title: 'LOTERÍA DUO', country: 'Mexico', area: 'Americas' },
};
const WORLD_REGIONS: WorldRegion[] = ['east-asia', 'south-asia', 'central-eurasia', 'africa', 'americas'];

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
    socket.on('voteRegion', p => this.voteRegion(socket, p)); socket.on('worldReady', () => this.worldReady(socket)); socket.on('worldAction', p => this.worldAction(socket, p));
    socket.on('travelAgain', () => this.travelAgain(socket)); socket.on('chooseAnotherGame', () => this.chooseAnotherGame(socket));
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
    const room: Room = { id, players: { guide: { socketId: a.socketId, country: a.country }, runner: { socketId: b.socketId, country: b.country } }, state, choices: {}, drawings: {}, reactions: {}, worldVotes: {}, worldReady: {}, lastMove: 0, lastSignal: 0 };
    this.rooms.set(id, room);
    for (const role of ['guide', 'runner'] as Role[]) { const s = this.io.sockets.sockets.get(room.players[role].socketId); if (s) { s.join(id); this.socketRooms.set(s.id, id); s.emit('matched', { ...state, role }); } }
  }
  private roomFor(socket: GameSocket) { const id = this.socketRooms.get(socket.id); return id ? this.rooms.get(id) : undefined; }
  private role(room: Room, id: string): Role | undefined { return room.players.guide.socketId === id ? 'guide' : room.players.runner.socketId === id ? 'runner' : undefined; }
  private stateFor(room: Room, role: Role): MatchState {
    const state: MatchState = { ...room.state, role, submitted: Boolean(room.drawings[role]), reactions: { ...room.reactions } };
    if (state.phase !== 'revealed') delete state.drawings; else state.drawings = { ...room.drawings };
    if (state.mode === 'world') { state.worldVoted = Boolean(room.worldVotes[role]); state.worldReady = Boolean(room.worldReady[role]); if (state.worldStage !== 'vote') state.worldChoices = [room.worldVotes.guide, room.worldVotes.runner]; state.worldData = room.worldData ? { ...room.worldData, scores: [...room.worldData.scores] as [number, number], board: [...room.worldData.board], shared: [...room.worldData.shared] } : undefined; }
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
    if (mode === 'world') { room.state.phase = 'world'; room.state.worldStage = 'vote'; room.state.introEndsAt = introEndsAt; this.emitState(room); room.worldTimer = setTimeout(() => this.resolveWorld(room), 30_000); return; }
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
  private voteRegion(socket: GameSocket, p: { region: unknown }) {
    const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'world' || r.state.worldStage !== 'vote' || !isWorldRegion(p?.region) || r.worldVotes[role]) return;
    r.worldVotes[role] = p.region; this.emitState(r); if (r.worldVotes.guide && r.worldVotes.runner) this.resolveWorld(r);
    else if (!r.worldTimer) r.worldTimer = setTimeout(() => this.resolveWorld(r), 30_000);
  }
  private resolveWorld(r: Room) {
    if (r.state.worldStage !== 'vote') return; if (r.worldTimer) clearTimeout(r.worldTimer);
    const a = r.worldVotes.guide, b = r.worldVotes.runner; const region = a && b ? (a === b ? a : (Math.random() < .5 ? a : b)) : a || b || WORLD_REGIONS[Math.floor(Math.random() * WORLD_REGIONS.length)];
    const picked = WORLD_GAMES[region]; r.state.worldRegion = region; r.state.worldGame = picked.game; r.state.worldStage = 'reveal'; r.state.phase = 'world'; r.state.worldEndsAt = Date.now() + 30_000; this.emitState(r);
    setTimeout(() => { const room = this.rooms.get(r.id); if (!room || room.state.worldStage !== 'reveal') return; room.state.worldStage = 'ready'; this.emitState(room); }, 3000);
  }
  private worldReady(socket: GameSocket) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'world' || r.state.worldStage !== 'ready' || r.worldReady[role]) return; r.worldReady[role] = true; this.emitState(r); if (r.worldReady.guide && r.worldReady.runner) this.startWorld(r); }
  private startWorld(r: Room) {
    r.state.worldStage = 'playing'; r.state.worldEndsAt = Date.now() + 180_000; const game = r.state.worldGame;
    r.worldData = game === 'oware' ? { turn: 'guide', scores: [0, 0], board: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], shared: [], goal: 25 } : game === 'loteria-duo' ? { turn: 'guide', scores: [0, 0], board: Array.from({ length: 9 }, (_, i) => i), shared: [], goal: 3 } : { turn: 'guide', scores: [0, 0], board: [0, 0], shared: [], goal: 2 };
    this.emitState(r); if (r.worldTimer) clearTimeout(r.worldTimer); r.worldTimer = setTimeout(() => this.finishWorld(r, 'draw'), 180_000);
  }
  private worldAction(socket: GameSocket, p: { action: string; value?: number }) {
    const r = this.roomFor(socket), role = r && this.role(r, socket.id), d = r?.worldData; if (!r || !role || r.state.mode !== 'world' || r.state.worldStage !== 'playing' || !d || d.turn !== role || typeof p?.action !== 'string' || p.action.length > 32) return;
    const index = role === 'guide' ? 0 : 1, game = r.state.worldGame;
    if (game === 'oware') { const pit = Number(p.value); if (!Number.isInteger(pit) || pit < 0 || pit > 5) return; const seeds = d.board[pit]; if (!seeds) return; d.board[pit] = 0; for (let i = 1; i <= seeds; i++) d.board[(pit + i) % 12]++; d.scores[index] += d.board[(pit + seeds) % 12] >= 2 ? d.board[(pit + seeds) % 12] : 0; }
    else if (game === 'loteria-duo') { const card = Number(p.value); if (!Number.isInteger(card) || card < 0 || card > 8 || d.shared.includes(card)) return; d.shared.push(card); d.scores[index]++; }
    else if (game === 'assyk-aim') { const force = Number(p.value); if (!Number.isInteger(force) || force < 1 || force > 3) return; d.scores[index] += force; d.lastResult = `The piece traveled ${force} steps`; }
    else { if (p.action !== 'throw' && p.action !== 'move') return; const roll = 1 + Math.floor(Math.random() * 5); d.board[index] = Math.min(20, d.board[index] + roll); d.scores[index] = d.board[index] >= 20 ? 2 : d.scores[index]; d.lastResult = `${role === 'guide' ? 'Guide' : 'Runner'} rolled ${roll}`; }
    d.lastAction = p.action; if (d.scores[index] >= d.goal || (game !== 'loteria-duo' && d.board[index] >= 20)) return this.finishWorld(r, role); d.turn = role === 'guide' ? 'runner' : 'guide'; this.emitState(r);
  }
  private finishWorld(r: Room, winner: Role | 'draw') { if (r.state.worldStage === 'finished') return; if (r.worldTimer) clearTimeout(r.worldTimer); r.state.worldStage = 'finished'; r.state.worldWinner = winner; r.state.worldEndsAt = Date.now(); this.emitState(r); }
  private travelAgain(socket: GameSocket) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'world' || r.state.worldStage !== 'finished') return; r.worldVotes = {}; r.worldReady = {}; r.worldData = undefined; r.state.worldRegion = undefined; r.state.worldGame = undefined; r.state.worldStage = 'vote'; r.state.worldWinner = undefined; this.emitState(r); }
  private chooseAnotherGame(socket: GameSocket) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); if (!r || !role || r.state.mode !== 'world') return; r.worldVotes = {}; r.worldReady = {}; r.worldData = undefined; r.state.mode = undefined; r.state.phase = 'selecting'; r.state.worldStage = undefined; r.state.worldRegion = undefined; r.state.worldGame = undefined; this.emitState(r); }
  private replay(socket: GameSocket) { const r = this.roomFor(socket), role = r && this.role(r, socket.id); const country = role && r ? r.players[role].country : this.socketCountries.get(socket.id); if (!country) return; if (r) this.removeRoom(r); if (socket.connected) this.join(socket, { countryCode: country.code }); }
  private leaveQueue(id: string) { this.waiting = this.waiting.filter(w => w.socketId !== id); this.broadcastStats(); }
  private disconnect(socket: GameSocket) { this.leaveQueue(socket.id); const r = this.roomFor(socket); this.socketCountries.delete(socket.id); if (!r) return; const other = this.role(r, socket.id) === 'guide' ? r.players.runner.socketId : r.players.guide.socketId; this.io.to(other).emit('peerDisconnected'); this.removeRoom(r); }
  private removeRoom(r: Room) { if (r.drawTimer) clearTimeout(r.drawTimer); if (r.worldTimer) clearTimeout(r.worldTimer); r.drawings = {}; r.worldData = undefined; r.worldVotes = {}; for (const role of ['guide', 'runner'] as Role[]) { this.socketRooms.delete(r.players[role].socketId); this.io.sockets.sockets.get(r.players[role].socketId)?.leave(r.id); } this.rooms.delete(r.id); }
  close() { return this.io.close(); }
}

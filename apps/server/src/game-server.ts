import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  countryByCode,
  distanceKm,
  generateMaze,
  movePosition,
  isDirection,
  isSafeMessage,
  isGameMode,
  isDrawReaction,
  initialSoupModel,
  isSoupInput,
  mulberry32,
  scheduleSoupEvent,
  stepSoup,
  type ClientToServerEvents,
  type Country,
  type DrawReaction,
  type GameMode,
  type MatchState,
  type Role,
  type ServerToClientEvents,
  type SessionRecords,
  type SoupModel,
  type SoupEventKind,
  type SoupSide,
  type SoupSnapshot,
} from "@without-words/shared";
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type Waiting = { socketId: string; country: Country; joinedAt: number };
export type Clock = {
  now: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};
type SoupRuntime = {
  model: SoupModel;
  seed: number;
  startsAt: number;
  lastTick: number;
  lastSnapshot: number;
  sides: Record<Role, SoupSide>;
  lastInput: Record<SoupSide, number>;
  lastAccepted: Record<SoupSide, number>;
  sequence: Record<SoupSide, number>;
  random: () => number;
  timer?: ReturnType<typeof setInterval>;
  ended: boolean;
  endReason?: SoupSnapshot["endReason"];
  scenarioIndex: number;
};
type Room = {
  id: string;
  players: Record<Role, { socketId: string; country: Country }>;
  state: MatchState;
  choices: Partial<Record<Role, GameMode>>;
  drawings: Partial<Record<Role, string>>;
  reactions: Partial<Record<Role, DrawReaction>>;
  lastMove: number;
  lastSignal: number;
  drawTimer?: ReturnType<typeof setTimeout>;
  introTimer?: ReturnType<typeof setTimeout>;
  soup?: SoupRuntime;
};
const TOPICS = [
    "HOME",
    "FREEDOM",
    "HAPPINESS",
    "LONELINESS",
    "FRIENDSHIP",
    "DREAM",
    "THE FUTURE",
    "A PERFECT DAY",
    "SAFE PLACE",
    "LOVE",
    "FEAR",
    "ADVENTURE",
  ],
  MAX_DRAWING_LENGTH = 360_000;
const nextTopic = (previous?: string) => {
  const a = TOPICS.filter((t) => t !== previous);
  return a[Math.floor(Math.random() * a.length)];
};
const systemClock: Clock = {
  now: Date.now,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
export type GameServerOptions = {
  clock?: Clock;
  seedSource?: () => number;
  randomFactory?: (seed: number) => () => number;
  testScenario?: readonly SoupEventKind[];
};
export class GameServer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  waiting: Waiting[] = [];
  rooms = new Map<string, Room>();
  socketRooms = new Map<string, string>();
  socketCountries = new Map<string, Country>();
  completedToday = 0;
  records: SessionRecords = {};
  private roomNo = 0;
  private seedNo = 0;
  private clock: Clock;
  private seedSource: () => number;
  private randomFactory: (seed: number) => () => number;
  private testScenario?: readonly SoupEventKind[];
  constructor(server: HttpServer, options: GameServerOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.seedSource = options.seedSource ?? (() => (this.clock.now() ^ (++this.seedNo * 2246822519)) >>> 0);
    this.randomFactory = options.randomFactory ?? mulberry32;
    this.testScenario = options.testScenario;
    this.io = new Server(server, {
      cors: { origin: true, credentials: false },
    });
    this.io.on("connection", (s) => this.connect(s));
  }
  stats() {
    return {
      waiting: this.waiting.length,
      completedToday: this.completedToday,
      activeRooms: this.rooms.size,
      records: structuredClone(this.records),
    };
  }
  private broadcastStats() {
    this.io.emit("stats", this.stats());
  }
  private connect(s: GameSocket) {
    s.emit("stats", this.stats());
    s.on("joinQueue", (p) => this.join(s, p));
    s.on("leaveQueue", () => this.leaveQueue(s.id));
    s.on("selectGame", (p) => this.selectGame(s, p));
    s.on("move", (p) => this.move(s, p));
    s.on("signal", (p) => this.signal(s, p));
    s.on("finalMessage", (p) => this.final(s, p));
    s.on("replay", () => this.replay(s));
    s.on("submitDrawing", (p) => this.submitDrawing(s, p));
    s.on("reactDrawing", (p) => this.reactDrawing(s, p));
    s.on("drawAgain", () => this.drawAgain(s));
    s.on("soupInput", (p) => this.soupInput(s, p));
    s.on("anotherBowl", () => this.anotherBowl(s));
    s.on("chooseAnotherGame", () => this.chooseAnotherGame(s));
    s.on("disconnect", () => this.disconnect(s));
  }
  private join(s: GameSocket, p: { countryCode: string }) {
    if (
      this.socketRooms.has(s.id) ||
      this.waiting.some((w) => w.socketId === s.id)
    )
      return;
    const c =
      typeof p?.countryCode === "string" && countryByCode(p.countryCode);
    if (!c) return s.emit("errorMessage", "Choose a valid country.");
    this.socketCountries.set(s.id, c);
    this.waiting.push({
      socketId: s.id,
      country: c,
      joinedAt: this.clock.now(),
    });
    s.emit("waiting");
    this.match();
    this.broadcastStats();
  }
  private match() {
    while (this.waiting.length >= 2) {
      const a = this.waiting[0];
      let i = this.waiting.findIndex(
        (w, n) => n > 0 && w.country.code !== a.country.code,
      );
      if (i < 0) i = 1;
      const b = this.waiting[i];
      this.waiting.splice(i, 1);
      this.waiting.shift();
      if (
        this.io.sockets.sockets.has(a.socketId) &&
        this.io.sockets.sockets.has(b.socketId)
      )
        this.create(a, b);
    }
  }
  private create(a: Waiting, b: Waiting) {
    const now = this.clock.now(),
      id = `room-${now.toString(36)}-${++this.roomNo}`,
      maze = generateMaze((now ^ (this.roomNo * 2654435761)) >>> 0),
      countries: [Country, Country] = [a.country, b.country],
      state: MatchState = {
        roomId: id,
        role: "guide",
        phase: "selecting",
        maze,
        position: maze.start,
        introEndsAt: 0,
        countries,
        distanceKm: distanceKm(...countries),
        finalMessages: {},
      },
      r: Room = {
        id,
        players: {
          guide: { socketId: a.socketId, country: a.country },
          runner: { socketId: b.socketId, country: b.country },
        },
        state,
        choices: {},
        drawings: {},
        reactions: {},
        lastMove: 0,
        lastSignal: 0,
      };
    this.rooms.set(id, r);
    for (const role of ["guide", "runner"] as Role[]) {
      const s = this.io.sockets.sockets.get(r.players[role].socketId);
      if (s) {
        s.join(id);
        this.socketRooms.set(s.id, id);
        s.emit("matched", { ...state, role });
      }
    }
    this.broadcastStats();
  }
  private roomFor(s: GameSocket) {
    const id = this.socketRooms.get(s.id);
    return id ? this.rooms.get(id) : undefined;
  }
  private role(r: Room, id: string): Role | undefined {
    return r.players.guide.socketId === id
      ? "guide"
      : r.players.runner.socketId === id
        ? "runner"
        : undefined;
  }
  private stateFor(r: Room, role: Role) {
    const s: MatchState = {
      ...r.state,
      role,
      submitted: Boolean(r.drawings[role]),
      reactions: { ...r.reactions },
    };
    if (s.phase !== "revealed") delete s.drawings;
    else s.drawings = { ...r.drawings };
    if (r.soup) {
      s.soupSide = r.soup.sides[role];
      s.soup = this.snapshot(r.soup);
    }
    return s;
  }
  private emitState(r: Room) {
    for (const role of ["guide", "runner"] as Role[])
      this.io
        .to(r.players[role].socketId)
        .emit("state", this.stateFor(r, role));
  }
  private selectGame(s: GameSocket, p: { mode: unknown }) {
    const r = this.roomFor(s),
      role = r && this.role(r, s.id);
    if (!r || !role || r.state.phase !== "selecting" || !isGameMode(p?.mode))
      return;
    r.choices[role] = p.mode;
    this.emitState(r);
    if (!r.choices.guide || !r.choices.runner) return;
    if (r.choices.guide !== r.choices.runner) {
      r.choices = {};
      this.emitState(r);
      s.emit("errorMessage", "Choose the same experiment as the other human.");
      return;
    }
    const mode = r.choices.guide;
    r.state.mode = mode;
    if (mode === "howIsTheSoup") return this.startSoup(r);
    const end = this.clock.now() + 3500;
    r.state.phase = "intro";
    r.state.introEndsAt = end;
    if (mode === "draw") {
      r.state.topic = nextTopic();
      r.state.drawEndsAt = end + 60000;
    }
    this.emitState(r);
    r.introTimer = this.clock.setTimeout(() => {
      if (!this.rooms.has(r.id) || r.state.phase !== "intro") return;
      r.state.phase = mode === "draw" ? "drawing" : "playing";
      if (mode === "maze") r.state.mazeStartedAt = this.clock.now();
      this.emitState(r);
      if (mode === "draw") this.startDrawTimer(r);
    }, 3500);
  }
  private startDrawTimer(r: Room) {
    if (r.drawTimer) this.clock.clearTimeout(r.drawTimer);
    r.drawTimer = this.clock.setTimeout(
      () => this.revealDrawings(r),
      Math.max(0, (r.state.drawEndsAt ?? this.clock.now()) - this.clock.now()),
    );
  }
  private move(s: GameSocket, p: { direction: unknown }) {
    const r = this.roomFor(s);
    if (
      !r ||
      r.state.mode !== "maze" ||
      this.role(r, s.id) !== "runner" ||
      r.state.phase !== "playing" ||
      !isDirection(p?.direction)
    )
      return;
    const now = this.clock.now();
    if (now - r.lastMove < 65) return;
    r.lastMove = now;
    const n = movePosition(r.state.maze, r.state.position, p.direction);
    if (n === r.state.position) return;
    r.state.position = n;
    if (n.x === r.state.maze.exit.x && n.y === r.state.maze.exit.y) {
      r.state.phase = "success";
      r.state.mazeElapsedMs = Math.max(0, now - (r.state.mazeStartedAt ?? now));
      const candidate = {
        durationMs: r.state.mazeElapsedMs,
        countries: [
          r.players.guide.country.name,
          r.players.runner.country.name,
        ] as [string, string],
      };
      if (
        !this.records.maze ||
        candidate.durationMs < this.records.maze.durationMs
      )
        this.records.maze = candidate;
      this.completedToday++;
      this.broadcastStats();
    }
    this.emitState(r);
  }
  private signal(s: GameSocket, p: { direction: unknown }) {
    const r = this.roomFor(s);
    if (
      !r ||
      r.state.mode !== "maze" ||
      this.role(r, s.id) !== "guide" ||
      r.state.phase !== "playing" ||
      !isDirection(p?.direction)
    )
      return;
    const now = this.clock.now();
    if (now - r.lastSignal < 400) return;
    r.lastSignal = now;
    this.io
      .to(r.players.runner.socketId)
      .emit("signal", { direction: p.direction, at: now });
  }
  private final(s: GameSocket, p: { message: unknown }) {
    const r = this.roomFor(s),
      role = r && this.role(r, s.id);
    if (
      !r ||
      !role ||
      r.state.mode !== "maze" ||
      r.state.phase !== "success" ||
      r.state.finalMessages[role] ||
      !isSafeMessage(p?.message)
    )
      return;
    r.state.finalMessages[role] = p.message;
    this.emitState(r);
  }
  private submitDrawing(s: GameSocket, p: { image: unknown }) {
    const r = this.roomFor(s),
      role = r && this.role(r, s.id);
    if (
      !r ||
      !role ||
      r.state.mode !== "draw" ||
      r.state.phase !== "drawing" ||
      r.drawings[role] ||
      typeof p?.image !== "string"
    )
      return;
    const valid =
      /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.image) &&
      p.image.length <= MAX_DRAWING_LENGTH;
    if (!valid)
      return s.emit("errorMessage", "Drawing is too large or invalid.");
    r.drawings[role] = p.image;
    this.emitState(r);
    if (r.drawings.guide && r.drawings.runner) this.revealDrawings(r);
  }
  private revealDrawings(r: Room) {
    if (r.state.phase !== "drawing") return;
    if (r.drawTimer) this.clock.clearTimeout(r.drawTimer);
    r.state.phase = "revealed";
    this.emitState(r);
  }
  private reactDrawing(s: GameSocket, p: { reaction: unknown }) {
    const r = this.roomFor(s),
      role = r && this.role(r, s.id);
    if (
      !r ||
      !role ||
      r.state.mode !== "draw" ||
      r.state.phase !== "revealed" ||
      r.reactions[role] ||
      !isDrawReaction(p?.reaction)
    )
      return;
    r.reactions[role] = p.reaction;
    this.emitState(r);
  }
  private drawAgain(s: GameSocket) {
    const r = this.roomFor(s),
      role = r && this.role(r, s.id);
    if (!r || !role || r.state.mode !== "draw" || r.state.phase !== "revealed")
      return;
    r.drawings = {};
    r.reactions = {};
    r.state.topic = nextTopic(r.state.topic);
    r.state.phase = "drawing";
    r.state.drawEndsAt = this.clock.now() + 60000;
    this.emitState(r);
    this.startDrawTimer(r);
  }
  private startSoup(r: Room) {
    this.stopSoup(r);
    const now = this.clock.now(),
      seed = this.seedSource() >>> 0,
      roundRandom = this.randomFactory(seed),
      flip = roundRandom() < 0.5,
      soup: SoupRuntime = {
        model: initialSoupModel(),
        seed,
        startsAt: now + 3000,
        lastTick: now,
        lastSnapshot: 0,
        sides: {
          guide: flip ? "left" : "right",
          runner: flip ? "right" : "left",
        },
        lastInput: { left: now + 3000, right: now + 3000 },
        lastAccepted: { left: 0, right: 0 },
        sequence: { left: -1, right: -1 },
        random: roundRandom,
        ended: false,
        scenarioIndex: 0,
      };
    r.soup = soup;
    r.state.phase = "soup";
    r.state.introEndsAt = soup.startsAt;
    this.emitState(r);
    soup.timer = this.clock.setInterval(() => this.tickSoup(r), 50);
  }
  private snapshot(s: SoupRuntime): SoupSnapshot {
    const now = this.clock.now();
    return {
      phase: s.ended ? "finished" : now < s.startsAt ? "countdown" : "playing",
      serverNow: now,
      startsAt: s.startsAt,
      elapsedMs: Math.max(0, now - s.startsAt),
      seed: s.seed,
      handles: {
        left: { ...s.model.handles.left },
        right: { ...s.model.handles.right },
      },
      pot: { ...s.model.pot },
      slosh: { ...s.model.slosh },
      soupRemaining: s.model.soupRemaining,
      events: s.model.events.map((e) => ({ ...e })),
      ingredients: s.model.ingredients.map((i) => ({ ...i })),
      ingredientsCaught: s.model.ingredientsCaught,
      fliesDodged: s.model.fliesDodged,
      endReason: s.endReason,
    };
  }
  private tickSoup(r: Room) {
    const s = r.soup;
    if (!s || s.ended) return;
    try {
      const now = this.clock.now(),
        dt = Math.min(100, Math.max(0, now - s.lastTick));
      s.lastTick = now;
      if (now >= s.startsAt) {
        const elapsed = now - s.startsAt;
        const forced = this.testScenario?.[s.scenarioIndex];
        if (forced && elapsed >= 1000 && !s.model.events.some((event) => elapsed < event.endsAt)) {
          s.model.nextEventAt = elapsed;
          const event = scheduleSoupEvent(s.model, elapsed, s.random, forced, true);
          if (event) s.scenarioIndex++;
        } else if (!this.testScenario) scheduleSoupEvent(s.model, elapsed, s.random);
        stepSoup(s.model, dt, elapsed);
        const out =
          s.model.pot.x < 0.1 ||
          s.model.pot.x > 0.9 ||
          s.model.pot.y < 0.18 ||
          s.model.pot.y > 0.88;
        if (out) s.model.outSince ??= now;
        else s.model.outSince = undefined;
        if (s.model.soupRemaining <= 20) return this.finishSoup(r, "spilled");
        if (s.model.outSince && now - s.model.outSince > 1200)
          return this.finishSoup(r, "out-of-bounds");
        if (now - Math.min(s.lastInput.left, s.lastInput.right) > 2000)
          return this.finishSoup(r, "inactive");
      }
      if (now - s.lastSnapshot >= 100) {
        s.lastSnapshot = now;
        this.io.to(r.id).emit("soupSnapshot", this.snapshot(s));
      }
    } catch {
      this.finishSoup(r, "inactive");
    }
  }
  private soupInput(socket: GameSocket, p: unknown) {
    const r = this.roomFor(socket),
      role = r && this.role(r, socket.id),
      s = r?.soup;
    if (!r || !role || !s || s.ended || !isSoupInput(p)) return;
    const side = s.sides[role],
      now = this.clock.now();
    if (now - s.lastAccepted[side] < 35 || p.sequence <= s.sequence[side])
      return;
    s.lastAccepted[side] = now;
    s.sequence[side] = p.sequence;
    s.lastInput[side] = now;
    const old = s.model.handles[side],
      dx = p.x - old.x,
      dy = p.y - old.y,
      d = Math.hypot(dx, dy),
      scale = d > 0.11 ? 0.11 / d : 1;
    s.model.handles[side] = {
      x: Math.max(0.04, Math.min(0.96, old.x + dx * scale)),
      y: Math.max(0.12, Math.min(0.9, old.y + dy * scale)),
    };
  }
  private finishSoup(r: Room, reason: SoupSnapshot["endReason"]) {
    const s = r.soup;
    if (!s || s.ended) return;
    s.ended = true;
    s.endReason = reason;
    if (s.timer) this.clock.clearInterval(s.timer);
    const duration = Math.max(0, this.clock.now() - s.startsAt),
      candidate = {
        durationMs: duration,
        countries: [
          r.players.guide.country.name,
          r.players.runner.country.name,
        ] as [string, string],
      };
    if (
      reason !== "disconnected" &&
      (!this.records.howIsTheSoup ||
        duration > this.records.howIsTheSoup.durationMs)
    )
      this.records.howIsTheSoup = candidate;
    this.io.to(r.id).emit("soupSnapshot", this.snapshot(s));
    this.emitState(r);
    this.broadcastStats();
  }
  private anotherBowl(s: GameSocket) {
    const r = this.roomFor(s);
    if (
      !r ||
      !this.role(r, s.id) ||
      r.state.mode !== "howIsTheSoup" ||
      !r.soup?.ended
    )
      return;
    this.startSoup(r);
  }
  private chooseAnotherGame(s: GameSocket) {
    const r = this.roomFor(s);
    if (
      !r ||
      !this.role(r, s.id) ||
      r.state.mode !== "howIsTheSoup" ||
      !r.soup?.ended
    )
      return;
    this.stopSoup(r);
    r.soup = undefined;
    r.choices = {};
    r.state.mode = undefined;
    r.state.phase = "selecting";
    r.state.introEndsAt = 0;
    this.emitState(r);
  }
  private replay(s: GameSocket) {
    const r = this.roomFor(s),
      role = r && this.role(r, s.id),
      c = role && r ? r.players[role].country : this.socketCountries.get(s.id);
    if (!c) return;
    if (r) this.removeRoom(r);
    if (s.connected) this.join(s, { countryCode: c.code });
  }
  private leaveQueue(id: string) {
    this.waiting = this.waiting.filter((w) => w.socketId !== id);
    this.broadcastStats();
  }
  private disconnect(s: GameSocket) {
    this.leaveQueue(s.id);
    const r = this.roomFor(s);
    this.socketCountries.delete(s.id);
    if (!r) return;
    if (r.soup && !r.soup.ended) this.finishSoup(r, "disconnected");
    const other =
      this.role(r, s.id) === "guide"
        ? r.players.runner.socketId
        : r.players.guide.socketId;
    this.io.to(other).emit("peerDisconnected");
    this.removeRoom(r);
  }
  private stopSoup(r: Room) {
    if (r.soup?.timer) this.clock.clearInterval(r.soup.timer);
  }
  private removeRoom(r: Room) {
    if (r.drawTimer) this.clock.clearTimeout(r.drawTimer);
    if (r.introTimer) this.clock.clearTimeout(r.introTimer);
    this.stopSoup(r);
    r.drawings = {};
    for (const role of ["guide", "runner"] as Role[]) {
      this.socketRooms.delete(r.players[role].socketId);
      this.io.sockets.sockets.get(r.players[role].socketId)?.leave(r.id);
    }
    this.rooms.delete(r.id);
    this.broadcastStats();
  }
  close() {
    for (const r of [...this.rooms.values()]) this.removeRoom(r);
    return this.io.close();
  }
}

import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { io as client, type Socket } from "socket.io-client";
import { GameServer, type Clock } from "../src/game-server";
import type { Direction, MatchState } from "@without-words/shared";

class FakeClock implements Clock {
  nowMs = 1_000_000;
  next = 1;
  tasks = new Map<number, { at: number; every?: number; fn: () => void }>();
  now = () => this.nowMs;
  setTimeout = ((fn: () => void, ms = 0) =>
    this.add(fn, ms)) as typeof setTimeout;
  clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    this.tasks.delete(Number(id));
  }) as unknown as typeof clearTimeout;
  setInterval = ((fn: () => void, ms = 0) =>
    this.add(fn, ms, ms)) as typeof setInterval;
  clearInterval = ((id: ReturnType<typeof setInterval>) => {
    this.tasks.delete(Number(id));
  }) as unknown as typeof clearInterval;
  private add(fn: () => void, ms: number, every?: number) {
    const id = this.next++;
    this.tasks.set(id, { at: this.nowMs + ms, every, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  advance(ms: number) {
    const end = this.nowMs + ms;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      this.nowMs = t.at;
      if (t.every !== undefined) t.at += t.every;
      else this.tasks.delete(id);
      t.fn();
    }
    this.nowMs = end;
  }
}
let server: http.Server | undefined, game: GameServer | undefined;
const clients: Socket[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await game?.close();
  server?.close();
});
const once = <T>(s: Socket, name: string) =>
  new Promise<T>((r) => s.once(name, r));
const where = <T>(s: Socket, name: string, p: (v: T) => boolean) =>
  new Promise<T>((r) => {
    const h = (v: T) => {
      if (p(v)) {
        s.off(name, h as never);
        r(v);
      }
    };
    s.on(name, h as never);
  });
async function setup(clock: FakeClock) {
  server = http.createServer();
  game = new GameServer(server, {
    clock,
    seedSource: () => 123,
    randomFactory: (seed) => {
      let n = seed;
      return () => (n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    },
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
}
async function pair() {
  const port = (server!.address() as { port: number }).port,
    a = client(`http://127.0.0.1:${port}`),
    b = client(`http://127.0.0.1:${port}`);
  clients.push(a, b);
  await Promise.all([once(a, "connect"), once(b, "connect")]);
  const ma = once<MatchState>(a, "matched"),
    mb = once<MatchState>(b, "matched");
  a.emit("joinQueue", { countryCode: "US" });
  b.emit("joinQueue", { countryCode: "JP" });
  const [A, B] = await Promise.all([ma, mb]);
  return { a, b, A, B };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function mazeRoute(state: MatchState) {
  const q: [{ x: number; y: number }, Direction[]][] = [[state.maze.start, []]],
    seen = new Set([`${state.maze.start.x},${state.maze.start.y}`]),
    dirs: [
      Direction,
      number,
      number,
      keyof (typeof state.maze.cells)[number][number],
    ][] = [
      ["up", 0, -1, "n"],
      ["right", 1, 0, "e"],
      ["down", 0, 1, "s"],
      ["left", -1, 0, "w"],
    ];
  while (q.length) {
    const [p, path] = q.shift()!;
    if (p.x === state.maze.exit.x && p.y === state.maze.exit.y) return path;
    for (const [d, dx, dy, wall] of dirs) {
      if (state.maze.cells[p.y][p.x][wall]) continue;
      const n = { x: p.x + dx, y: p.y + dy },
        k = `${n.x},${n.y}`;
      if (
        n.x >= 0 &&
        n.y >= 0 &&
        n.x < state.maze.width &&
        n.y < state.maze.height &&
        !seen.has(k)
      ) {
        seen.add(k);
        q.push([n, [...path, d]]);
      }
    }
  }
  throw new Error("no route");
}
async function startSoup(clock: FakeClock) {
  const p = await pair(),
    sa = where<any>(p.a, "state", (s) => s.mode === "howIsTheSoup"),
    sb = where<any>(p.b, "state", (s) => s.mode === "howIsTheSoup");
  p.a.emit("selectGame", { mode: "howIsTheSoup" });
  p.b.emit("selectGame", { mode: "howIsTheSoup" });
  await Promise.all([sa, sb]);
  clock.advance(3000);
  return p;
}
describe("server authority and cleanup", () => {
  it("emits game over once and clears its simulation timer", async () => {
    const c = new FakeClock();
    await setup(c);
    const { a, b } = await startSoup(c),
      room = [...game!.rooms.values()][0] as any;
    let finished = 0;
    a.on("soupSnapshot", (s: any) => {
      if (s.phase === "finished") finished++;
    });
    const ended = where<any>(a, "soupSnapshot", (s) => s.phase === "finished");
    room.soup.model.soupRemaining = 20;
    c.advance(100);
    await ended;
    expect(finished).toBe(1);
    expect(c.tasks.size).toBe(0);
    c.advance(5000);
    await flush();
    expect(finished).toBe(1);
    a.disconnect();
    b.disconnect();
  });
  it("keeps only the longest soup record and ignores forged client time/record fields", async () => {
    const c = new FakeClock();
    await setup(c);
    const { a, b } = await startSoup(c);
    let room = [...game!.rooms.values()][0] as any;
    c.nowMs += 5000;
    (game as any).finishSoup(room, "spilled");
    const first = game!.records.howIsTheSoup!.durationMs;
    a.emit("soupInput", {
      x: 0.5,
      y: 0.5,
      sequence: 1,
      durationMs: 999999,
      record: { durationMs: 999999 },
    });
    a.emit("record", { durationMs: 999999 });
    await flush();
    expect(game!.records.howIsTheSoup!.durationMs).toBe(first);
    let started = where<any>(a, "state", (s) => s.soup?.phase === "countdown");
    a.emit("anotherBowl");
    await started;
    c.advance(3000);
    room = [...game!.rooms.values()][0] as any;
    c.nowMs += 8000;
    (game as any).finishSoup(room, "spilled");
    expect(game!.records.howIsTheSoup!.durationMs).toBeGreaterThan(first);
    const best = game!.records.howIsTheSoup!.durationMs;
    started = where<any>(a, "state", (s) => s.soup?.phase === "countdown");
    a.emit("anotherBowl");
    await started;
    c.advance(3000);
    room = [...game!.rooms.values()][0] as any;
    c.nowMs += 1000;
    (game as any).finishSoup(room, "spilled");
    expect(game!.records.howIsTheSoup!.durationMs).toBe(best);
    expect(Object.keys(game!.records.howIsTheSoup!)).toEqual([
      "durationMs",
      "countries",
    ]);
    expect(JSON.stringify(game!.records)).not.toMatch(
      /socket|127\.0\.0\.1|name|ip/i,
    );
    a.disconnect();
    b.disconnect();
  });
  it("keeps only the fastest maze record using server start and win clocks", async () => {
    const c = new FakeClock();
    await setup(c);
    const play = async (step: number) => {
      const { a, b, A, B } = await pair(),
        runner = A.role === "runner" ? a : b,
        state = A.role === "runner" ? A : B,
        intro = where<any>(runner, "state", (s) => s.phase === "intro");
      a.emit("selectGame", { mode: "maze" });
      b.emit("selectGame", { mode: "maze" });
      await intro;
      const playing = where<any>(runner, "state", (s) => s.phase === "playing");
      c.advance(3500);
      await playing;
      const serverSocket = game!.io.sockets.sockets.get(runner.id!)!;
      for (const d of mazeRoute(state)) {
        c.advance(step);
        (game as any).move(serverSocket, { direction: d });
      }
      a.disconnect();
      b.disconnect();
      await flush();
    };
    await play(150);
    const first = game!.records.maze!.durationMs;
    await play(70);
    expect(game!.records.maze!.durationMs).toBeLessThan(first);
    const best = game!.records.maze!.durationMs;
    await play(200);
    expect(game!.records.maze!.durationMs).toBe(best);
    expect(Object.keys(game!.records.maze!)).toEqual([
      "durationMs",
      "countries",
    ]);
  });
  it("cleans simulation timers and socket listeners on disconnect", async () => {
    const c = new FakeClock();
    await setup(c);
    const { a, b } = await startSoup(c);
    expect(c.tasks.size).toBe(1);
    const disconnected = once(b, "peerDisconnected");
    a.disconnect();
    await disconnected;
    expect(c.tasks.size).toBe(0);
    expect(game!.rooms.size).toBe(0);
    expect(game!.socketRooms.size).toBe(0);
    expect(game!.io.sockets.sockets.size).toBe(1);
    b.disconnect();
  });
});

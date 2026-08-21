import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { io as client, type Socket } from "socket.io-client";
import { GameServer } from "../src/game-server";

let server: http.Server | undefined;
let game: GameServer | undefined;
const clients: Socket[] = [];

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await game?.close();
  server?.close();
});
const event = <T>(s: Socket, name: string) =>
  new Promise<T>((resolve) => s.once(name, resolve));
const eventWhere = <T>(
  s: Socket,
  name: string,
  predicate: (value: T) => boolean,
) =>
  new Promise<T>((resolve) => {
    const handler = (value: T) => {
      if (predicate(value)) {
        s.off(name, handler as never);
        resolve(value);
      }
    };
    s.on(name, handler as never);
  });
async function pair(port: number) {
  const a = client(`http://127.0.0.1:${port}`),
    b = client(`http://127.0.0.1:${port}`);
  clients.push(a, b);
  await Promise.all([event(a, "connect"), event(b, "connect")]);
  const ma = event<any>(a, "matched"),
    mb = event<any>(b, "matched");
  a.emit("joinQueue", { countryCode: "US" });
  b.emit("joinQueue", { countryCode: "JP" });
  const [matchA, matchB] = await Promise.all([ma, mb]);
  return { a, b, matchA, matchB };
}

describe("matchmaking", () => {
  it("pairs FIFO clients with distinct roles", async () => {
    server = http.createServer();
    game = new GameServer(server);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const { matchA, matchB } = await pair((server.address() as any).port);
    expect(matchA.roomId).toBe(matchB.roomId);
    expect(new Set([matchA.role, matchB.role])).toEqual(
      new Set(["guide", "runner"]),
    );
    expect(game!.stats().waiting).toBe(0);
  });

  it("keeps drawings private, reveals on both submit, relays reactions, and starts a new topic", async () => {
    server = http.createServer();
    game = new GameServer(server);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const { a, b, matchA } = await pair((server.address() as any).port);
    const introA = eventWhere<any>(a, "state", (s) => s.phase === "intro"),
      introB = eventWhere<any>(b, "state", (s) => s.phase === "intro");
    a.emit("selectGame", { mode: "draw" });
    b.emit("selectGame", { mode: "draw" });
    const [ia, ib] = await Promise.all([introA, introB]);
    expect(ia.mode).toBe("draw");
    expect(ib.topic).toBe(ia.topic);
    expect(ia.drawEndsAt - ia.introEndsAt).toBe(60000);
    await eventWhere<any>(a, "state", (s) => s.phase === "drawing");
    const invalid = event<any>(a, "errorMessage");
    a.emit("submitDrawing", { image: "not-an-image" });
    expect(await invalid).toMatch(/invalid|large/i);
    const privateState = eventWhere<any>(
      a,
      "state",
      (s) => s.phase === "drawing" && s.submitted === true,
    );
    a.emit("submitDrawing", { image: "data:image/png;base64,aGVsbG8=" });
    expect((await privateState).drawings).toBeUndefined();
    const revealedA = eventWhere<any>(
        a,
        "state",
        (s) => s.phase === "revealed",
      ),
      revealedB = eventWhere<any>(b, "state", (s) => s.phase === "revealed");
    b.emit("submitDrawing", { image: "data:image/webp;base64,aGVsbG8=" });
    const [ra, rb] = await Promise.all([revealedA, revealedB]);
    expect(Object.keys(ra.drawings)).toHaveLength(2);
    expect(rb.drawings).toEqual(ra.drawings);
    const reaction = eventWhere<any>(
      b,
      "state",
      (s) => s.phase === "revealed" && s.reactions?.[matchA.role] === "✦",
    );
    a.emit("reactDrawing", { reaction: "✦" });
    expect((await reaction).reactions[matchA.role]).toBe("✦");
    const next = eventWhere<any>(a, "state", (s) => s.phase === "drawing");
    a.emit("drawAgain");
    expect((await next).topic).not.toBe(ra.topic);
    const disconnected = event(b, "peerDisconnected");
    a.disconnect();
    await disconnected;
    b.disconnect();
    expect(game!.rooms.size).toBe(0);
  }, 20000);

  it("starts an authoritative soup round with opposite sides and synchronized snapshots", async () => {
    server = http.createServer();
    game = new GameServer(server);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const { a, b } = await pair((server.address() as any).port);
    const soupA = eventWhere<any>(
      a,
      "state",
      (s) => s.mode === "howIsTheSoup" && s.soup,
    );
    const soupB = eventWhere<any>(
      b,
      "state",
      (s) => s.mode === "howIsTheSoup" && s.soup,
    );
    a.emit("selectGame", { mode: "howIsTheSoup" });
    b.emit("selectGame", { mode: "howIsTheSoup" });
    const [sa, sb] = await Promise.all([soupA, soupB]);
    expect(new Set([sa.soupSide, sb.soupSide])).toEqual(
      new Set(["left", "right"]),
    );
    expect(sa.soup.startsAt).toBe(sb.soup.startsAt);
    expect(sa.soup.seed).toBe(sb.soup.seed);
    const snapA = event<any>(a, "soupSnapshot"),
      snapB = event<any>(b, "soupSnapshot");
    a.emit("soupInput", { x: 0.3, y: 0.5, sequence: 1 });
    b.emit("soupInput", { x: 0.7, y: 0.5, sequence: 1 });
    const [xa, xb] = await Promise.all([snapA, snapB]);
    expect(xa.pot).toEqual(xb.pot);
    expect(xa.soupRemaining).toBe(xb.soupRemaining);
    a.emit("soupInput", { x: NaN, y: 0.5, sequence: 2 });
    a.emit("soupInput", { x: Infinity, y: 0.5, sequence: 3 });
    const disconnected = event(b, "peerDisconnected");
    a.disconnect();
    await disconnected;
    expect(game!.rooms.size).toBe(0);
    b.disconnect();
  }, 20000);
});

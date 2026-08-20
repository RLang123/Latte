import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { io as client, type Socket } from 'socket.io-client';
import { GameServer } from '../src/game-server';

let server: http.Server | undefined;
let game: GameServer | undefined;
const clients: Socket[] = [];

afterEach(async () => { clients.splice(0).forEach(c => c.disconnect()); await game?.close(); server?.close(); });
const event = <T>(s: Socket, name: string) => new Promise<T>(resolve => s.once(name, resolve));
const eventWhere = <T>(s: Socket, name: string, predicate: (value: T) => boolean) => new Promise<T>(resolve => {
  const handler = (value: T) => { if (predicate(value)) { s.off(name, handler as never); resolve(value); } };
  s.on(name, handler as never);
});
async function pair(port: number) {
  const a = client(`http://127.0.0.1:${port}`), b = client(`http://127.0.0.1:${port}`); clients.push(a, b);
  await Promise.all([event(a, 'connect'), event(b, 'connect')]);
  const ma = event<any>(a, 'matched'), mb = event<any>(b, 'matched');
  a.emit('joinQueue', { countryCode: 'US' }); b.emit('joinQueue', { countryCode: 'JP' });
  const [matchA, matchB] = await Promise.all([ma, mb]); return { a, b, matchA, matchB };
}

describe('matchmaking', () => {
  it('pairs FIFO clients with distinct roles', async () => {
    server = http.createServer(); game = new GameServer(server); await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    const { matchA, matchB } = await pair((server.address() as any).port);
    expect(matchA.roomId).toBe(matchB.roomId); expect(new Set([matchA.role, matchB.role])).toEqual(new Set(['guide', 'runner'])); expect(game!.stats().waiting).toBe(0);
  });

  it('keeps drawings private, reveals on both submit, relays reactions, and starts a new topic', async () => {
    server = http.createServer(); game = new GameServer(server); await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    const { a, b, matchA } = await pair((server.address() as any).port);
    const introA = eventWhere<any>(a, 'state', s => s.phase === 'intro'), introB = eventWhere<any>(b, 'state', s => s.phase === 'intro');
    a.emit('selectGame', { mode: 'draw' }); b.emit('selectGame', { mode: 'draw' });
    const [ia, ib] = await Promise.all([introA, introB]); expect(ia.mode).toBe('draw'); expect(ib.topic).toBe(ia.topic); expect(ia.drawEndsAt - ia.introEndsAt).toBe(60000);
    await eventWhere<any>(a, 'state', s => s.phase === 'drawing');
    const invalid = event<any>(a, 'errorMessage'); a.emit('submitDrawing', { image: 'not-an-image' }); expect(await invalid).toMatch(/invalid|large/i);
    const privateState = eventWhere<any>(a, 'state', s => s.phase === 'drawing' && s.submitted === true); a.emit('submitDrawing', { image: 'data:image/png;base64,aGVsbG8=' }); expect((await privateState).drawings).toBeUndefined();
    const revealedA = eventWhere<any>(a, 'state', s => s.phase === 'revealed'), revealedB = eventWhere<any>(b, 'state', s => s.phase === 'revealed');
    b.emit('submitDrawing', { image: 'data:image/webp;base64,aGVsbG8=' }); const [ra, rb] = await Promise.all([revealedA, revealedB]);
    expect(Object.keys(ra.drawings)).toHaveLength(2); expect(rb.drawings).toEqual(ra.drawings);
    const reaction = eventWhere<any>(b, 'state', s => s.phase === 'revealed' && s.reactions?.[matchA.role] === '✦'); a.emit('reactDrawing', { reaction: '✦' }); expect((await reaction).reactions[matchA.role]).toBe('✦');
    const next = eventWhere<any>(a, 'state', s => s.phase === 'drawing'); a.emit('drawAgain'); expect((await next).topic).not.toBe(ra.topic); const disconnected = event(b, 'peerDisconnected'); a.disconnect(); await disconnected; b.disconnect(); expect(game!.rooms.size).toBe(0);
  }, 20000);

  it('runs private region voting and a server-authoritative world round', async () => {
    server = http.createServer(); game = new GameServer(server); await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    const { a, b } = await pair((server.address() as any).port);
    const worldA = eventWhere<any>(a, 'state', s => s.mode === 'world' && s.worldStage === 'vote');
    const worldB = eventWhere<any>(b, 'state', s => s.mode === 'world' && s.worldStage === 'vote');
    a.emit('selectGame', { mode: 'world' }); b.emit('selectGame', { mode: 'world' }); await Promise.all([worldA, worldB]);
    const aVoted = eventWhere<any>(a, 'state', s => s.worldStage === 'vote' && s.worldVoted); a.emit('voteRegion', { region: 'africa' }); expect((await aVoted).worldRegion).toBeUndefined();
    const bResult = eventWhere<any>(b, 'state', s => s.worldStage === 'reveal'); b.emit('voteRegion', { region: 'africa' }); const result = await bResult; expect(result.worldRegion).toBe('africa'); expect(result.worldGame).toBe('oware'); expect(result.worldVoted).toBe(true);
    const readyA = eventWhere<any>(a, 'state', s => s.worldStage === 'ready'); const readyB = eventWhere<any>(b, 'state', s => s.worldStage === 'ready'); await Promise.all([readyA, readyB]);
    const playing = eventWhere<any>(a, 'state', s => s.worldStage === 'playing'); a.emit('worldReady'); b.emit('worldReady'); const started = await playing; expect(started.worldData.turn).toBe('guide');
    const guide = started.role === 'guide' ? a : b; const runner = started.role === 'guide' ? b : a; const next = eventWhere<any>(runner, 'state', s => s.worldData?.lastAction === 'sow'); guide.emit('worldAction', { action: 'sow', value: 0 }); expect((await next).worldData.lastAction).toBe('sow');
    guide.emit('voteRegion', { region: 'americas' }); await new Promise(r => setTimeout(r, 100)); expect(game!.rooms.size).toBe(1); a.disconnect(); b.disconnect();
  }, 20000);
});

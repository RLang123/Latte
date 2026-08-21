# WITHOUT WORDS

A two-person real-time experiment with three games: **BLIND MAZE**, **SAME WORD, TWO WORLDS**, and **HOW’S THE SOUP?** There are no accounts, bots, chat, profiles, camera, microphone, precise location, analytics, or database.

## Run and verify

Requires Node.js 20+ and npm 10+.

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run e2e
```

Open port 3000 in two independent browser contexts, choose self-selected countries, and press **FIND A HUMAN**. Express, Vite, Socket.IO, and `/health` share this single port. Production-style startup is:

```bash
npm run build
NODE_ENV=production npm run start -w @without-words/server
```

The deterministic browser event suite uses `NODE_ENV=test SOUP_E2E=1` on the server and `SOUP_E2E=1 npm run e2e` on the runner. This injects a fixed seed and ordered server-side event source; it adds no client command or Socket.IO cheat event. The injection is gated by both variables and remains disabled whenever `NODE_ENV=production`, even if `SOUP_E2E` is present.

## Architecture and authority

- `apps/client`: React/Vite UI, pointer/touch input, local rendering and snapshot interpolation.
- `apps/server`: FIFO matchmaking, rooms, consensus, authoritative Maze and Soup state, drawing exchange, records, and cleanup.
- `packages/shared`: event contracts, strict runtime validators, deterministic maze logic, seeded Soup model, and country reference data.

The server owns all winning, timing, Soup state, event selection, collisions, and records. Soup input contains only a normalized coordinate and monotonic sequence for the sender's assigned handle. The server validates finite 0–1 coordinates, role, room and phase; rate-limits input; limits instantaneous travel; runs a fixed 20 Hz simulation; and sends compact 10 Hz snapshots. Clients never submit time, score, seed, Soup amount, event state, or a result.

Soup has a three-second shared countdown. Input is accepted during it, while survival time begins at the server `startsAt`. The first eight seconds have no hazards. Later seeded events are selected from abstract good/bad ingredients, flies, wind, boiling, steam, pepper, and a ladle according to server elapsed time. A round ends at 20% Soup, after sustained out-of-bounds movement, after the two-second input grace period, or on disconnect. **ANOTHER BOWL** resets all state with a fresh seed; **CHOOSE ANOTHER GAME** returns the pair to consensus selection.

Blind Maze time begins only when its intro ends and the server enters `playing`; it ends when the authoritative movement check reaches the exit. Replay creates a new attempt. Same Word keeps drawings private until both are submitted or its server deadline expires.

## Records and privacy

`SESSION BEST` is process-local. It resets whenever the Render instance restarts and is not shared across instances. Personal bests are display-only values stored in that browser's `localStorage`; they do not sync to another browser or device and are never trusted for a server record. There are no accounts or permanent database.

Server records contain only duration and the pair's self-selected country names. They contain no name, IP address, identifier, drawing, or credential. `/health` exposes service status, aggregate room/waiting values, and record-presence booleans only; it does not expose countries or record details.

## Socket.IO contract

Client events are `joinQueue`, `leaveQueue`, `selectGame`, Maze `move`/`signal`/`finalMessage`/`replay`, drawing `submitDrawing`/`reactDrawing`/`drawAgain`, and Soup `soupInput`/`anotherBowl`/`chooseAnotherGame`. Server events are `stats`, `waiting`, `matched`, `state`, `signal`, `soupSnapshot`, `peerDisconnected`, and safe `errorMessage` text. Invalid, duplicate, out-of-role, out-of-room, out-of-phase, and rate-limited events are ignored.

## Render

Use one Free Web Service:

```text
Build command: npm run build
Start command: NODE_ENV=production npm run start -w @without-words/server
Health check: /health
```

One instance is required while matchmaking and records are held in memory. Multi-instance deployment requires a shared state adapter. Free instances may sleep, so the first request after idle can be slower.

## Current limitations

The country list is local and self-selected. Matchmaking has no invite-code isolation. Drawing result sharing is a local PNG. Soup uses a deliberately predictable slosh model, not a particle-fluid simulation.

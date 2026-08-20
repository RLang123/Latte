# WITHOUT WORDS

A two-person, real-time cooperative experiment: one stranger sees a maze and sends four directional light pulses; the other sees only nearby cells and must find the exit. There are no accounts, bots, chat, profiles, camera, microphone, precise location, analytics, or database.

## Run locally or in Codespaces

Requires Node.js 20+ and npm 10+.

```bash
npm install
npm run dev
```

Open **port 3000**. Express, Vite, Socket.IO, and `/health` share this single port and bind to `0.0.0.0`. In Codespaces, make port 3000 public if the second browser is outside your GitHub session, then share the forwarded URL. Socket.IO uses the page origin, so no frontend URL variable is needed.

For a two-person test, open that same URL in two browser windows (or one regular and one private window), choose countries, and press **Find a Human** in both. The first arrival becomes Guide and the second Runner. The private test link is simply your unique Codespaces forwarded-port URL; the app never stores it.

Production-style run:

```bash
npm run build
NODE_ENV=production npm run start -w @without-words/server
```

Quality commands:

```bash
npm test
npm run typecheck
npm run build
```

## Architecture

- `apps/client`: React, TypeScript, and Vite; landing, queue, synchronized intro, role-specific game, disconnection, and success screens.
- `apps/server`: Express and Socket.IO; owns the FIFO queue, roles, rooms, position, throttles, win state, count, and cleanup. State lives behind `GameServer`, ready for a future shared-state adapter.
- `packages/shared`: runtime validation, event contracts, deterministic maze/movement logic, and a local country reference-point dataset.

Mazes use seeded recursive backtracking. Only the server accepts moves, checks walls, changes position, and declares success. Movement is limited to about 15 accepted events/second and Guide pulses to 2.5/second. Membership checks prevent duplicate queue or room placement. Matchmaking prefers a different-country person already waiting, then pairs the oldest two rather than stalling.

Countries are self-selected and unverified. Distances are great-circle estimates between local country reference points (capital cities), not exact user-to-user distances.

## Socket.IO protocol

Invalid, out-of-role, out-of-phase, and rate-limited events are ignored.

Client → server:

- `joinQueue { countryCode }`: join once with a supported two-letter code.
- `leaveQueue`: leave matchmaking.
- `move { direction }`: Runner-only; `up | down | left | right`.
- `signal { direction }`: Guide-only light pulse.
- `finalMessage { message }`: after success, once; `thank-you | that-was-fun | we-made-it | good-luck`.
- `replay`: leave a completed room and queue with the same country.

Server → client:

- `stats { waiting, completedToday }`: real in-memory values only.
- `waiting`: queue entry confirmed.
- `matched MatchState`: role, maze, intro deadline, countries, and distance.
- `state MatchState`: authoritative position, phase, and safe-message update.
- `signal { direction, at }`: light pulse delivered to the Runner.
- `peerDisconnected`: the other socket left and the room was removed.
- `errorMessage string`: safe validation feedback.

## MVP limitations

State and the daily count reset when the process restarts and do not span multiple instances. The local dataset covers 20 countries. Matchmaking has no invite-code isolation; anyone on the same server joins its FIFO pool. Result sharing is a local PNG download, so no content is sent to a third party.

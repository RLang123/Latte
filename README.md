# WITHOUT WORDS

A two-person, real-time cooperative experiment: one stranger sees a maze and sends four directional light pulses; the other sees only nearby cells and must find the exit. They can also choose **SAME WORD, TWO WORLDS**, a private timed drawing exchange. There are no accounts, bots, chat, profiles, camera, microphone, precise location, analytics, or database.

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

- `apps/client`: React, TypeScript, and Vite; landing, queue, game selection, synchronized intro, Blind Maze, private drawing canvas, reveal/reaction screen, disconnection, and success screens.
- `apps/server`: Express and Socket.IO; owns the FIFO queue, roles, rooms, game choice, position, draw topic/timer, submitted drawings, reactions, win state, count, and cleanup. State lives behind `GameServer`, ready for a future shared-state adapter.
- `packages/shared`: runtime validation, event contracts, deterministic maze/movement logic, and a local country reference-point dataset.

Mazes use seeded recursive backtracking. Only the server accepts moves, checks walls, changes position, and declares success. Movement is limited to about 15 accepted events/second and Guide pulses to 2.5/second. Membership checks prevent duplicate queue or room placement. Matchmaking prefers a different-country person already waiting, then pairs the oldest two rather than stalling.

Countries are self-selected and unverified. Distances are great-circle estimates between local country reference points (capital cities), not exact user-to-user distances.

## Socket.IO protocol

Invalid, out-of-role, out-of-phase, and rate-limited events are ignored.

Client → server:

- `joinQueue { countryCode }`: join once with a supported two-letter code.
- `leaveQueue`: leave matchmaking.
- `selectGame { mode }`: choose `maze` or `draw`; both players must agree.
- `move { direction }`: Runner-only; `up | down | left | right`.
- `signal { direction }`: Guide-only light pulse.
- `finalMessage { message }`: after success, once; `thank-you | that-was-fun | we-made-it | good-luck`.
- `replay`: leave a completed room and queue with the same country.
- `submitDrawing { image }`: Draw-only, one validated PNG submission per player.
- `reactDrawing { reaction }`: Draw-only, one `✦ | ♡ | ☀ | ! | ?` reaction.
- `drawAgain`: Draw-only, clears the current room's drawings and starts a different topic.

Server → client:

- `stats { waiting, completedToday }`: real in-memory values only.
- `waiting`: queue entry confirmed.
- `matched MatchState`: role, maze, intro deadline, countries, and distance.
- `state MatchState`: authoritative position, phase, and safe-message update.
- `signal { direction, at }`: light pulse delivered to the Runner.
- `peerDisconnected`: the other socket left and the room was removed.
- `errorMessage string`: safe validation feedback.

## Same Word, Two Worlds

After matchmaking, both players choose the same mini-game. For the drawing mode, the server chooses one topic from the local topic list and sends the same value to both players. The server sets a 60-second `drawEndsAt` deadline; a drawing is submitted once as a size-limited PNG data URL and is never included in state broadcasts before `revealed`. The room transitions to `revealed` when both drawings arrive or the deadline expires. Only one of the five reactions (`✦`, `♡`, `☀`, `!`, `?`) can be sent per player. `drawAgain` clears drawings and reactions in the same room and selects a different topic. Disconnect and room removal clear the temporary drawing data and timer.

The canvas is intentionally local while drawing: pointer events stay in the browser, with keyboard-free controls for pen color, three brush sizes, undo, clear, and one final PNG submission. The canvas uses `touch-action: none` so drawing does not scroll the mobile page.

## Render deployment

The current Render deployment runs as one Free Web Service so in-memory matchmaking remains coherent:

```text
Build command: npm run build
Start command: NODE_ENV=production npm run start -w @without-words/server
Health check: /health
```

After changing the repository, push `main` and trigger a Render redeploy (or wait for automatic GitHub deploy). The service must remain a single instance; scaling to multiple instances requires moving queue/room state to shared storage. Render Free services can sleep after inactivity, so the first request after idle may take longer.

## MVP limitations

State and the daily count reset when the process restarts and do not span multiple instances. The local dataset covers 20 countries. Matchmaking has no invite-code isolation; anyone on the same server joins its FIFO pool. Result sharing is a local PNG download, so no content is sent to a third party.

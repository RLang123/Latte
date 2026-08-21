import http from "node:http";
import path from "node:path";
import express from "express";
import { GameServer } from "./game-server.js";
const app = express(),
  server = http.createServer(app),
  e2eSoup = process.env.NODE_ENV === "test" && process.env.SOUP_E2E === "1",
  game = new GameServer(server, {
    ...(e2eSoup
      ? {
          seedSource: () => 424242,
          testScenario: [
            "good",
            "bad",
            "fly",
            "wind",
            "boil",
            "steam",
            "pepper",
            "ladle",
          ] as const,
        }
      : {}),
  }),
  port = Number(process.env.PORT || 3000),
  prod = process.env.NODE_ENV === "production";
app.get("/health", (_req, res) => {
  const stats = game.stats();
  res.json({
    ok: true,
    waiting: stats.waiting,
    completedToday: stats.completedToday,
    activeRooms: stats.activeRooms,
    hasMazeRecord: Boolean(stats.records.maze),
    hasSoupRecord: Boolean(stats.records.howIsTheSoup),
  });
});
if (prod) {
  const client = path.resolve(process.cwd(), "../client/dist");
  app.use(express.static(client));
  app.get("*", (_req, res) => res.sendFile(path.join(client, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: path.resolve(process.cwd(), "../client"),
    server: { middlewareMode: true, host: "0.0.0.0" },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
server.listen(port, "0.0.0.0", () =>
  console.log(`WITHOUT WORDS listening on http://0.0.0.0:${port}`),
);
const shutdown = () =>
  server.close(() => {
    game.close();
    process.exit(0);
  });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

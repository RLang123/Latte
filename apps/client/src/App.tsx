import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { toPng } from "html-to-image";
import {
  COUNTRIES,
  type Direction,
  type DrawReaction,
  type GameMode,
  type MatchState,
  type PublicStats,
  type SafeMessage,
  type SoupInput,
  type SoupSnapshot,
} from "@without-words/shared";
import { Controls, MazeView } from "./MazeView";
import { DrawGame } from "./DrawCanvas";
import { SoupGame } from "./SoupGame";

const socket = io({ autoConnect: true });
type Screen =
  "landing" | "waiting" | "select" | "game" | "draw" | "disconnected";
const messages: Record<SafeMessage, [string, string]> = {
  "thank-you": ["✦", "Thank you"],
  "that-was-fun": ["⌁", "That was fun"],
  "we-made-it": ["◇", "We made it"],
  "good-luck": ["↗", "Good luck"],
};

export function App() {
  const [screen, setScreen] = useState<Screen>("landing"),
    [country, setCountry] = useState(""),
    [stats, setStats] = useState<PublicStats>({
      waiting: 0,
      completedToday: 0,
      activeRooms: 0,
      records: {},
    });
  const [soupSnapshot, setSoupSnapshot] = useState<SoupSnapshot>();
  const [state, setState] = useState<MatchState>(),
    [signal, setSignal] = useState<Direction>(),
    [now, setNow] = useState(Date.now()),
    [selectedMode, setSelectedMode] = useState<GameMode>();
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    socket
      .on("stats", setStats)
      .on("waiting", () => setScreen("waiting"))
      .on("matched", (s) => {
        setState(s);
        setSelectedMode(undefined);
        setSoupSnapshot(undefined);
        setScreen("select");
      })
      .on("state", (s) => {
        setState(s);
        if (s.soup) setSoupSnapshot(s.soup);
        if (s.phase === "selecting") {
          setSelectedMode(undefined);
          setScreen("select");
        } else if (s.mode === "draw") setScreen("draw");
        else setScreen("game");
      })
      .on("soupSnapshot", setSoupSnapshot)
      .on("signal", (p) => {
        setSignal(p.direction);
        setTimeout(() => setSignal(undefined), 900);
      })
      .on("peerDisconnected", () => setScreen("disconnected"))
      .on("errorMessage", (message) => window.alert(message));
    return () => {
      clearInterval(timer);
      socket.off();
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!state || state.mode !== "maze" || state.phase !== "playing") return;
      const d: Record<string, Direction> = {
        ArrowUp: "up",
        w: "up",
        W: "up",
        ArrowDown: "down",
        s: "down",
        S: "down",
        ArrowLeft: "left",
        a: "left",
        A: "left",
        ArrowRight: "right",
        d: "right",
        D: "right",
      };
      if (d[e.key]) {
        e.preventDefault();
        action(d[e.key]);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state]);
  const action = (d: Direction) =>
    socket.emit(state?.role === "guide" ? "signal" : "move", {
      direction: d,
    } as never);
  const find = () => {
    if (country) socket.emit("joinQueue", { countryCode: country });
  };
  const home = () => {
    socket.emit("leaveQueue");
    setScreen("landing");
    setState(undefined);
    setSelectedMode(undefined);
  };
  const chooseGame = (mode: GameMode) => {
    setSelectedMode(mode);
    socket.emit("selectGame", { mode });
  };

  if (screen === "landing")
    return (
      <Landing
        country={country}
        setCountry={setCountry}
        stats={stats}
        find={find}
      />
    );
  if (screen === "waiting")
    return (
      <main className="center">
        <Atmosphere />
        <div className="waiting-orbit">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Looking across the world</p>
        <h1>Finding another human…</h1>
        <p className="muted">The wait is real. No stand-ins, no bots.</p>
        <button className="text-button" onClick={home}>
          Stop looking
        </button>
      </main>
    );
  if (screen === "disconnected")
    return (
      <main className="center">
        <Atmosphere />
        <div className="broken">⌁</div>
        <p className="eyebrow">The connection faded</p>
        <h1>The other human left.</h1>
        <p className="muted">Sometimes distance wins. You can try again.</p>
        <button
          className="primary"
          onClick={() => {
            setScreen("waiting");
            if (country) socket.emit("joinQueue", { countryCode: country });
          }}
        >
          FIND ANOTHER HUMAN
        </button>
        <button className="text-button" onClick={home}>
          Return home
        </button>
      </main>
    );
  if (!state) return null;
  if (screen === "select")
    return <GameSelect selected={selectedMode} onSelect={chooseGame} />;
  if (state.mode === "draw")
    return (
      <DrawGame
        state={state}
        onSubmit={(image) => socket.emit("submitDrawing", { image })}
        onReact={(reaction: DrawReaction) =>
          socket.emit("reactDrawing", { reaction })
        }
        onAgain={() => socket.emit("drawAgain")}
        onHome={home}
      />
    );
  if (state.mode === "howIsTheSoup")
    return (
      <SoupGame
        state={state}
        snapshot={soupSnapshot}
        onInput={(p: SoupInput) => socket.emit("soupInput", p)}
        onAgain={() => socket.emit("anotherBowl")}
        onChoose={() => socket.emit("chooseAnotherGame")}
      />
    );
  if (state.phase === "success")
    return <MazeSuccess state={state} card={card} onHome={home} />;
  const countdown = Math.max(0, Math.ceil((state.introEndsAt - now) / 1000));
  if (state.phase === "intro")
    return (
      <main className="center intro">
        <Atmosphere />
        <div className="connection-line">
          <span />
          <i />
          <span />
        </div>
        <p className="eyebrow">Two places · one moment</p>
        <h1>Another human is here.</h1>
        <p className="role-reveal">
          You are the <b>{state.role}</b>
        </p>
        <div className="countdown">{countdown || "·"}</div>
      </main>
    );
  return (
    <main className="game">
      <header>
        <div className="wordmark">WITHOUT WORDS</div>
        <div className="presence">
          <span /> THE OTHER HUMAN IS HERE
        </div>
      </header>
      <div className="game-copy">
        <p className="eyebrow">YOU ARE THE {state.role.toUpperCase()}</p>
        <h2>
          {state.role === "guide" ? "Light the way." : "Follow what you feel."}
        </h2>
        <p>
          {state.role === "guide"
            ? "You see the whole path. Send only light."
            : "The world reveals itself as you move."}
        </p>
      </div>
      <MazeView state={state} onAction={action} signal={signal} />
      <div className="game-controls">
        <span>{state.role === "guide" ? "SEND A SIGNAL" : "MOVE"}</span>
        <Controls role={state.role} onAction={action} />
        <small>
          {state.role === "runner"
            ? "Arrow keys or WASD"
            : "Four pulses. No words."}
        </small>
      </div>
    </main>
  );
}

function Landing({
  country,
  setCountry,
  stats,
  find,
}: {
  country: string;
  setCountry: (value: string) => void;
  stats: PublicStats;
  find: () => void;
}) {
  return (
    <main className="landing">
      <Atmosphere />
      <header>
        <div className="wordmark">
          WITHOUT WORDS <i />
        </div>
        <div className="live">
          <span />
          {stats.waiting} {stats.waiting === 1 ? "human" : "humans"} waiting ·{" "}
          {stats.completedToday} connected today
        </div>
      </header>
      <section className="hero">
        <p className="eyebrow">A global experiment in human understanding</p>
        <h1>
          Can two strangers understand each other
          <br />
          without a single word?
        </h1>
        <div className="rules">
          No names. <i /> No chat. <i /> No translation.
          <br />
          <b>Just two humans trying to understand.</b>
        </div>
        <label className="country">
          <span>Where are you joining from?</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Select your country</option>
            {COUNTRIES.map((c) => (
              <option value={c.code} key={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!country} onClick={find}>
          FIND A HUMAN <span>↗</span>
        </button>
        <SessionBest stats={stats} />
        <p className="privacy">
          No account. No exact location. Country is self-selected.{" "}
          <button
            onClick={() =>
              document.querySelector<HTMLDialogElement>("#privacy")?.showModal()
            }
          >
            Privacy
          </button>
        </p>
      </section>
      <dialog id="privacy">
        <button
          className="close"
          onClick={(e) =>
            (e.currentTarget.parentElement as HTMLDialogElement).close()
          }
          aria-label="Close privacy explanation"
        >
          ×
        </button>
        <h2>Only enough to connect</h2>
        <p>
          We keep your selected country and active game in server memory. There
          are no accounts, trackers, cameras, microphones, or precise location
          requests.
        </p>
      </dialog>
    </main>
  );
}

function GameSelect({
  selected,
  onSelect,
}: {
  selected?: GameMode;
  onSelect: (mode: GameMode) => void;
}) {
  return (
    <main className="select-game">
      <Atmosphere />
      <p className="eyebrow">THE OTHER HUMAN IS HERE</p>
      <h1>Choose how to meet.</h1>
      <p className="select-intro">
        Both of you must choose the same experiment.
      </p>
      <div className="game-options">
        {(
          [
            [
              "maze",
              "01",
              "BLIND MAZE",
              "Guide with light. Move without seeing the whole path.",
              "↗",
            ],
            [
              "draw",
              "02",
              "SAME WORD, TWO WORLDS",
              "Draw the same idea. Reveal two different worlds.",
              "✦",
            ],
            [
              "howIsTheSoup",
              "03",
              "HOW’S THE SOUP?",
              "Hold one handle each. Keep the bowl steady together.",
              "≈",
            ],
          ] as const
        ).map(([id, n, title, copy, icon]) => (
          <button
            key={id}
            className={selected === id ? "game-option selected" : "game-option"}
            onClick={() => onSelect(id)}
          >
            <span className="option-index">{n}</span>
            <strong>{title}</strong>
            <small>{copy}</small>
            <i>{icon}</i>
          </button>
        ))}
      </div>
      {selected && (
        <p className="select-waiting">
          <span /> Waiting for the other human to choose
        </p>
      )}
    </main>
  );
}

function SessionBest({ stats }: { stats: PublicStats }) {
  const fmt = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  return (
    <aside className="session-best">
      <b>SESSION BEST</b>
      {stats.records.maze && (
        <span>
          BLIND MAZE<strong>{fmt(stats.records.maze.durationMs)}</strong>
          <small>{stats.records.maze.countries.join(" × ")}</small>
        </span>
      )}
      {stats.records.howIsTheSoup && (
        <span>
          HOW’S THE SOUP?
          <strong>{fmt(stats.records.howIsTheSoup.durationMs)}</strong>
          <small>{stats.records.howIsTheSoup.countries.join(" × ")}</small>
        </span>
      )}
    </aside>
  );
}

function MazeSuccess({
  state,
  card,
  onHome,
}: {
  state: MatchState;
  card: React.RefObject<HTMLDivElement>;
  onHome: () => void;
}) {
  const mine = state.finalMessages[state.role],
    other = state.finalMessages[state.role === "guide" ? "runner" : "guide"];
  useEffect(() => {
    if (state.mazeElapsedMs === undefined) return;
    const key = "withoutWords.best.maze";
    const old = Number(localStorage.getItem(key) ?? Number.POSITIVE_INFINITY);
    if (state.mazeElapsedMs < old)
      localStorage.setItem(key, String(state.mazeElapsedMs));
  }, [state.mazeElapsedMs]);
  const mazeTime = `${String(Math.floor((state.mazeElapsedMs ?? 0) / 60_000)).padStart(2, "0")}:${String(Math.floor((state.mazeElapsedMs ?? 0) / 1_000) % 60).padStart(2, "0")}`;
  const download = async () => {
    if (!card.current) return;
    const a = document.createElement("a");
    a.download = "without-words-connection.png";
    a.href = await toPng(card.current, { pixelRatio: 2 });
    a.click();
  };
  return (
    <main className="success">
      <Atmosphere />
      <div className="success-glow" />
      <p className="eyebrow">CONNECTION COMPLETE</p>
      <h1>
        YOU UNDERSTOOD
        <br />A STRANGER
      </h1>
      <div className="result-card" ref={card}>
        <div className="card-mark">WITHOUT WORDS</div>
        <p className="eyebrow">TIME TOGETHER · {mazeTime}</p>
        <div className="places">
          <div>
            <b>{state.countries[0].city}</b>
            <span>{state.countries[0].name}</span>
          </div>
          <div className="distance">
            <i>↕</i>
            <strong>{state.distanceKm.toLocaleString()} km</strong>
            <small>APPROXIMATE</small>
          </div>
          <div>
            <b>{state.countries[1].city}</b>
            <span>{state.countries[1].name}</span>
          </div>
        </div>
        <p>No words were exchanged.</p>
      </div>
      <div className="final-message">
        <p>
          {other
            ? `The other human sent: ${messages[other][1]}`
            : "One last signal?"}
        </p>
        {!mine ? (
          <div>
            {Object.entries(messages).map(([id, [icon, label]]) => (
              <button
                key={id}
                onClick={() =>
                  socket.emit("finalMessage", { message: id as SafeMessage })
                }
              >
                <b>{icon}</b>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <p className="sent">
            Sent: {messages[mine][0]} {messages[mine][1]}
          </p>
        )}
      </div>
      <div className="success-actions">
        <button className="primary" onClick={download}>
          DOWNLOAD CARD
        </button>
        <button className="text-button" onClick={() => socket.emit("replay")}>
          Meet someone new
        </button>
        <button className="text-button" onClick={onHome}>
          Return home
        </button>
      </div>
      <p className="privacy">
        Distance uses country reference points and is approximate.
      </p>
    </main>
  );
}
function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

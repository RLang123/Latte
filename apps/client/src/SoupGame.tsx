import { useEffect, useRef, useState } from "react";
import type {
  MatchState,
  SoupInput,
  SoupSnapshot,
} from "@without-words/shared";

const fmt = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const eventIcon: Record<string, string> = {
  good: "◇",
  bad: "✕",
  fly: "⌁",
  wind: "➜",
  boil: "◌",
  steam: "≋",
  pepper: "⁙",
  ladle: "╱",
};
export function SoupGame({
  state,
  snapshot,
  onInput,
  onAgain,
  onChoose,
}: {
  state: MatchState;
  snapshot?: SoupSnapshot;
  onInput: (p: SoupInput) => void;
  onAgain: () => void;
  onChoose: () => void;
}) {
  const snap = snapshot ?? state.soup,
    area = useRef<HTMLDivElement>(null),
    pointer = useRef<number>(),
    last = useRef({ x: state.soupSide === "left" ? 0.28 : 0.72, y: 0.56 }),
    seq = useRef(0),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      if (snap?.phase !== "finished")
        onInput({ ...last.current, sequence: seq.current++ });
    }, 40);
    return () => clearInterval(timer);
  }, [onInput, snap?.phase]);
  useEffect(() => {
    if (snap?.phase === "finished") {
      const key = "withoutWords.best.howIsTheSoup",
        old = Number(localStorage.getItem(key) || 0);
      if (snap.elapsedMs > old)
        localStorage.setItem(key, String(snap.elapsedMs));
    }
  }, [snap?.phase, snap?.elapsedMs]);
  if (!snap || !state.soupSide) return null;
  const point = (e: React.PointerEvent) => {
    if (pointer.current !== undefined && pointer.current !== e.pointerId)
      return;
    const b = area.current?.getBoundingClientRect();
    if (!b) return;
    last.current = {
      x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    };
  };
  const down = (e: React.PointerEvent) => {
    if (pointer.current !== undefined) return;
    pointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    point(e);
  };
  const up = (e: React.PointerEvent) => {
    if (pointer.current === e.pointerId) {
      pointer.current = undefined;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };
  const countdown = Math.max(1, Math.ceil((snap.startsAt - now) / 1000)),
    active = snap.events.filter(
      (e) => snap.elapsedMs >= e.startsAt && snap.elapsedMs < e.endsAt,
    ),
    warnings = snap.events.filter(
      (e) => snap.elapsedMs >= e.warningAt && snap.elapsedMs < e.startsAt,
    );
  if (snap.phase === "finished")
    return (
      <main className="soup-result">
        <p className="eyebrow">BOWL COMPLETE</p>
        <h1>HOW’S THE SOUP?</h1>
        <div className="soup-result-grid">
          <span>
            TIME TOGETHER<b>{fmt(snap.elapsedMs)}</b>
          </span>
          <span>
            SOUP LEFT<b>{Math.round(snap.soupRemaining)}%</b>
          </span>
          <span>
            INGREDIENTS CAUGHT<b>{snap.ingredientsCaught}</b>
          </span>
          <span>
            FLIES DODGED<b>{snap.fliesDodged}</b>
          </span>
        </div>
        <div
          className="end-reason"
          aria-label={`Round ended: ${snap.endReason}`}
        >
          {snap.endReason === "spilled"
            ? "≈"
            : snap.endReason === "out-of-bounds"
              ? "◇"
              : "⌁"}{" "}
          <small>
            {snap.endReason === "inactive"
              ? "THE HANDLES WENT QUIET"
              : snap.endReason === "out-of-bounds"
                ? "THE BOWL DRIFTED AWAY"
                : "THE SOUP RAN LOW"}
          </small>
        </div>
        <div>
          <button className="primary" onClick={onAgain}>
            ANOTHER BOWL
          </button>
          <button className="text-button" onClick={onChoose}>
            CHOOSE ANOTHER GAME
          </button>
        </div>
      </main>
    );
  return (
    <main className="soup-screen">
      <header>
        <div className="wordmark">WITHOUT WORDS</div>
        <div className="soup-role">
          <i /> YOUR {state.soupSide.toUpperCase()} HANDLE
        </div>
      </header>
      <div className="soup-hud">
        <span>
          TIME TOGETHER<b>{fmt(snap.elapsedMs)}</b>
        </span>
        <span>
          SOUP<b>{Math.round(snap.soupRemaining)}%</b>
        </span>
      </div>
      <div className="event-strip">
        {warnings.map((e) => (
          <i className="warning" key={e.id} data-event={e.kind} data-start={e.startsAt}>
            {eventIcon[e.kind]}
          </i>
        ))}
        {active.map((e) => (
          <i key={e.id} data-event={e.kind} data-start={e.startsAt}>{eventIcon[e.kind]}</i>
        ))}
      </div>
      <div
        ref={area}
        className="soup-area"
        data-side={state.soupSide}
        data-elapsed={snap.elapsedMs}
        data-soup={snap.soupRemaining}
        onPointerDown={down}
        onPointerMove={point}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div className="kitchen-grid" />
        <div className="steam-lines">≋　≋　≋</div>
        {snap.ingredients.map((i) => (
          <div
            key={i.id}
            className={`ingredient ${["toast", "soap", "wrapper"].includes(i.kind) ? "bad" : "good"}`}
            style={{ left: `${i.x * 100}%`, top: `${i.y * 100}%` }}
            aria-label={i.kind}
          >
            {["toast", "soap", "wrapper"].includes(i.kind) ? "✕" : "◇"}
          </div>
        ))}
        <div
          className="pot-rig"
          style={{
            left: `${snap.pot.x * 100}%`,
            top: `${snap.pot.y * 100}%`,
            transform: `translate(-50%,-50%) rotate(${snap.pot.angle}rad)`,
          }}
        >
          <div className="handle left" />
          <div className="pot">
            <div
              className="soup-liquid"
              style={{
                transform: `translateX(${snap.slosh.offset * 90}px) rotate(${-snap.pot.angle}rad)`,
              }}
            >
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="handle right" />
        </div>
        {(["left", "right"] as const).map((side) => (
          <div
            key={side}
            className={`glove ${side} ${side === state.soupSide ? "mine" : "theirs"}`}
            style={{
              left: `${snap.handles[side].x * 100}%`,
              top: `${snap.handles[side].y * 100}%`,
            }}
          >
            <i />
          </div>
        ))}
        {snap.phase === "countdown" && (
          <div className="soup-countdown">
            <small>HOLD YOUR {state.soupSide.toUpperCase()} HANDLE</small>
            <b>{countdown}</b>
          </div>
        )}
      </div>
    </main>
  );
}

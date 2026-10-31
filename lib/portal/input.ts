// Keyboard controls: WASD/arrows walk, Space push-to-talk, Enter focuses chat, Esc closes/blur.
// Never reacts while the user types in an input/textarea/contenteditable (or with Ctrl/Cmd/Alt held).

export type InputHooks = {
  /** Walk one step in a SCREEN direction (sx, sy in -1..1; up = sy -1). Returns nothing; engine decides if it can queue. */
  walk: (sx: number, sy: number, fresh: boolean) => void;
  /** key released: no more steps are queued by this module */
  stopWalk: () => void;
  pttStart: () => void;
  pttEnd: () => void;
  /** Enter pressed outside a text field */
  focusChat: () => void;
  /** Esc pressed outside a text field: close the top-most window */
  closeTop: () => void;
};

const KEYS: Record<string, "u" | "d" | "l" | "r"> = {
  ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r",
};

export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function attachInput(h: InputHooks) {
  const held = new Set<"u" | "d" | "l" | "r">();
  let space = false;
  let raf = 0;

  const dir = () => ({ sx: (held.has("r") ? 1 : 0) - (held.has("l") ? 1 : 0), sy: (held.has("d") ? 1 : 0) - (held.has("u") ? 1 : 0) });

  const loop = () => {
    raf = 0;
    if (!held.size) return;
    const { sx, sy } = dir();
    if (sx || sy) h.walk(sx, sy, false);
    raf = requestAnimationFrame(loop);
  };

  const releaseAll = () => {
    if (held.size) {
      held.clear();
      h.stopWalk();
    }
    if (space) {
      space = false;
      h.pttEnd();
    }
  };

  const down = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }
    const k = KEYS[e.code];
    if (k) {
      e.preventDefault();
      if (e.repeat || held.has(k)) return;
      held.add(k);
      const { sx, sy } = dir();
      h.walk(sx, sy, true);
      if (!raf) raf = requestAnimationFrame(loop);
      return;
    }
    if (e.code === "Space") {
      // Space on a focused button would click it; we own it in the room
      e.preventDefault();
      if (e.repeat || space) return;
      space = true;
      h.pttStart();
    } else if (e.key === "Enter") {
      e.preventDefault();
      h.focusChat();
    } else if (e.key === "Escape") {
      h.closeTop();
    }
  };

  const up = (e: KeyboardEvent) => {
    const k = KEYS[e.code];
    if (k && held.delete(k) && !held.size) h.stopWalk();
    if (e.code === "Space" && space) {
      space = false;
      h.pttEnd();
    }
  };

  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", releaseAll);
  const vis = () => document.hidden && releaseAll();
  document.addEventListener("visibilitychange", vis);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", releaseAll);
    document.removeEventListener("visibilitychange", vis);
    if (raf) cancelAnimationFrame(raf);
    releaseAll();
  };
}

/*
 * Calm mode: a widget that sits on the desktop all day must cost almost nothing while nobody is looking at it.
 *
 * Why: Chromium produces 60 frames a second for as long as ANY animation is running, even when nothing visibly
 * changes. Measured in the packaged app (software rendering, Linux): collapsed idle cost 3.8% of a core with the
 * character's two infinite animations running and 0.4% with them paused. So after a short quiet spell the shell
 * adds `.calm` to #app (CSS pauses every animation) and, while collapsed, gives the character a brief "sign of
 * life" (2.4 s every 20-40 s; each pause/resume costs a fixed re-commit, so rarer is cheaper) so it never looks frozen. Anything that happens (pointer, key, reminder, drink) wakes it.
 *
 * Theme-agnostic on purpose: themes keep writing ordinary infinite CSS animations. One-shot effects must call
 * wake(ms) with their duration so they are not paused halfway.
 *
 * The clock, timers, randomness and event target are injectable so the logic is unit-tested without a browser.
 */
export const QUIET_MS = Object.freeze({ collapsed: 3000, expanded: 20000 });
export const LIFE_EVERY_MS = Object.freeze([20000, 40000]);
export const LIFE_MS = 2400;
const POINTER_THROTTLE_MS = 250;
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'];

/**
 * @param {{root: {classList: {toggle(name: string, on: boolean): void, contains(name: string): boolean}},
 *          isExpanded: () => boolean, events?: EventTarget, now?: () => number,
 *          setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, random?: () => number}} deps
 */
export function createCalm({ root, isExpanded, events = null, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  let quietTimer = null;
  let lifeTimer = null;
  let lastWake = -Infinity;
  let holdUntil = 0;
  let disposed = false;
  let hidden = false;

  const isCalm = () => root.classList.contains('calm');
  const setCalm = (on) => root.classList.toggle('calm', on);
  const clearTimers = () => {
    clearTimer(quietTimer);
    clearTimer(lifeTimer);
  };

  function lifeSign() {
    const [lo, hi] = LIFE_EVERY_MS;
    lifeTimer = setTimer(() => {
      if (disposed) return;
      setCalm(false);
      lifeTimer = setTimer(() => {
        if (disposed) return;
        setCalm(true);
        if (!isExpanded()) lifeSign();
      }, LIFE_MS);
    }, lo + random() * (hi - lo));
  }

  function enterCalm() {
    if (disposed) return;
    setCalm(true);
    if (!isExpanded()) lifeSign(); // only the collapsed character needs to look alive
  }

  /** Something is happening: animate now, and calm down again after a quiet spell (at least `holdMs` from now). */
  function wake(holdMs = 0) {
    if (disposed || hidden) return;
    const t = now();
    holdUntil = Math.max(holdUntil, t + holdMs);
    if (holdMs === 0 && !isCalm() && t - lastWake < POINTER_THROTTLE_MS) return; // pointermove storms
    lastWake = t;
    clearTimers();
    setCalm(false);
    quietTimer = setTimer(enterCalm, Math.max(QUIET_MS[isExpanded() ? 'expanded' : 'collapsed'], holdUntil - t));
  }

  const onActivity = () => wake();
  if (events) for (const type of ACTIVITY_EVENTS) events.addEventListener(type, onActivity, { capture: true, passive: true });
  wake();

  /** The widget is not on screen: stay calm and show no signs of life until it is shown again (setHidden(false)). */
  function setHidden(value) {
    if (disposed) return;
    hidden = Boolean(value);
    if (hidden) {
      clearTimers();
      setCalm(true);
    } else {
      wake(); // shown again: animate, then calm after the quiet spell
    }
  }

  return {
    wake,
    setHidden,
    isCalm,
    dispose() {
      disposed = true;
      clearTimers();
      if (events) for (const type of ACTIVITY_EVENTS) events.removeEventListener(type, onActivity, { capture: true });
      setCalm(false);
    },
  };
}

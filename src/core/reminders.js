/*
 * Decides what to do about a due hydration reminder, taking the Pomodoro into account.
 * PURE: callers pass `now` and the Pomodoro snapshot.
 *
 * Rules (from the plan):
 *  - Never interrupt a running focus session: hold the reminder until the break starts,
 *    but only for up to MAX_HOLD_MS past its due time, then deliver anyway.
 *  - After alerting, keep the "due" banner up and re-alert every NAG_INTERVAL_MS until a cup
 *    is logged (logging a cup changes `dueAt`, which naturally resets everything).
 */

export const NAG_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_HOLD_MS = 20 * 60 * 1000;

/**
 * @param {object} a
 * @param {number|null} a.dueAt         ms when the cup is due (null = nothing scheduled)
 * @param {number} a.now
 * @param {number|null} a.lastNotifiedAt ms of the last alert for this due time (or null)
 * @param {boolean} a.remindersOn
 * @param {boolean} a.syncBreaks        hold reminders until a Pomodoro break
 * @param {{running:boolean, phase:string}} a.pomodoro
 * @returns {'idle'|'hold'|'notify'|'due'}
 *   idle   - nothing to show
 *   hold   - due but held for the next break (show a quiet hint, no alert)
 *   notify - due: alert now (chime + notification) and show the banner
 *   due    - due and already alerted recently: keep the banner, no new alert yet
 */
export function reminderDecision({ dueAt, now, lastNotifiedAt, remindersOn, syncBreaks, pomodoro }) {
  if (!remindersOn || dueAt == null || now < dueAt) return 'idle';

  const focusing = pomodoro.running && pomodoro.phase === 'focus';
  if (syncBreaks && focusing && now - dueAt < MAX_HOLD_MS) return 'hold';

  const alertedForThisDue = lastNotifiedAt != null && lastNotifiedAt >= dueAt;
  if (alertedForThisDue && now - lastNotifiedAt < NAG_INTERVAL_MS) return 'due';
  return 'notify';
}

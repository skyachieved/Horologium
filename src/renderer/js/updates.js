/*
 * The update status from the main process (src/main/updates.js), kept here so the News view and the News bubble's
 * dot read the same thing. Lives outside the widget, which is rebuilt on theme or language changes.
 */
import * as S from './app-state.js';
import { hasUnseenNews } from '../core/updates.js';

let status = null;
const listeners = new Set();

export async function initUpdates() {
  const bridge = window.horologium;
  bridge.onUpdateStatus((next) => {
    status = next;
    listeners.forEach((fn) => fn(status));
  });
  status = await bridge.updateStatus();
  // a fresh install has nothing new to show; upgrades get the News dot until News is opened
  if (!S.getState().ui.newsSeen && !S.getState().ui.onboarded) S.patch({ ui: { newsSeen: S.env.version } });
}

export const updateStatus = () => status;

export function onUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The News bubble's dot: an update is waiting, or News was not opened since this version arrived. */
export const newsDot = () => ['available', 'downloading', 'ready'].includes(status?.state) || hasUnseenNews({ seen: S.getState().ui.newsSeen, current: S.env.version });

export function markNewsSeen() {
  if (S.getState().ui.newsSeen !== S.env.version) S.patch({ ui: { newsSeen: S.env.version } });
}

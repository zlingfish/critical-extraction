export interface ShortcutGateState {
  unlocked: boolean;
  openProgress: number;
  colliderEnabled: boolean;
}

export function createShortcutGate(unlocked = false): ShortcutGateState {
  return { unlocked, openProgress: unlocked ? 1 : 0, colliderEnabled: !unlocked };
}

export function unlockShortcutGate(state: ShortcutGateState, hasAccess: boolean): ShortcutGateState {
  if (!hasAccess || state.unlocked) return state;
  return { ...state, unlocked: true };
}

export function advanceShortcutGate(
  state: ShortcutGateState,
  deltaSeconds: number,
  openSpeed = 1,
  colliderReleaseProgress = 0.58,
): ShortcutGateState {
  if (!state.unlocked) return state;
  const delta = Math.max(0, deltaSeconds);
  const speed = Math.max(0, openSpeed);
  const openProgress = Math.min(1, state.openProgress + delta * speed);
  return {
    unlocked: true,
    openProgress,
    colliderEnabled: openProgress < Math.min(1, Math.max(0, colliderReleaseProgress)),
  };
}

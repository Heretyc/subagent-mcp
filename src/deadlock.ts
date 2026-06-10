export interface DeadlockWindow {
  arm(): void;
  active(): boolean;
  consume(): void;
}

export function createDeadlockWindow(size = 3): DeadlockWindow {
  let counter = 0;
  return {
    arm() { counter = size; },
    active() { return counter > 0; },
    consume() { counter = Math.max(0, counter - 1); },
  };
}

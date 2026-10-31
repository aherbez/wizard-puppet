// Tracks which keys are currently held down, by physical key code
// (e.g. 'KeyW', 'ArrowUp') so Shift / Caps Lock don't matter.
const pressed = new Set<string>();

const CAPTURED = /^(Arrow|Key[WASDQER]$|Space$)/;

window.addEventListener('keydown', (e) => {
  if (CAPTURED.test(e.code)) e.preventDefault();
  pressed.add(e.code);
});
window.addEventListener('keyup', (e) => pressed.delete(e.code));
window.addEventListener('blur', () => pressed.clear());

export function isDown(code: string): boolean {
  return pressed.has(code);
}

// Returns -1, 0, or 1 depending on which side has any of its keys held.
export function axis(negative: string[], positive: string[]): number {
  return (positive.some(isDown) ? 1 : 0) - (negative.some(isDown) ? 1 : 0);
}

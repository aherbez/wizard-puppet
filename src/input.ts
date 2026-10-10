// Tracks which keys are currently held down.
const pressed = new Set<string>();

window.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) e.preventDefault();
  pressed.add(e.key);
});
window.addEventListener('keyup', (e) => pressed.delete(e.key));
window.addEventListener('blur', () => pressed.clear());

export function isDown(key: string): boolean {
  return pressed.has(key);
}

// Returns -1, 0, or 1 along each axis based on arrow keys.
export function arrowAxes(): { x: number; y: number } {
  return {
    x: (isDown('ArrowRight') ? 1 : 0) - (isDown('ArrowLeft') ? 1 : 0),
    y: (isDown('ArrowUp') ? 1 : 0) - (isDown('ArrowDown') ? 1 : 0),
  };
}

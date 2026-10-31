import * as THREE from 'three';

// A 0..1 value that rises while a key is held and falls back to 0 when released.
// Progress moves linearly; squaring it eases the rise in (slow start, speeding
// up) and makes the fall settle gently into 0.
export class HoldRamp {
  private progress = 0;

  constructor(
    private readonly riseTime: number, // seconds from 0 to 1
    private readonly fallTime: number, // seconds from 1 to 0
  ) {}

  update(held: boolean, dt: number): number {
    this.progress = held
      ? Math.min(1, this.progress + dt / this.riseTime)
      : Math.max(0, this.progress - dt / this.fallTime);
    return this.progress * this.progress;
  }
}

// A 0..1 value that chases 1 while a key is held and 0 when released. Each
// frame it closes a fixed fraction of the remaining gap, so it moves fast at
// first and eases into the target.
export class HoldSpring {
  private value = 0;

  constructor(
    private readonly riseRate: number, // higher = snappier; ~3/rate seconds to 95%
    private readonly fallRate: number,
  ) {}

  update(held: boolean, dt: number): number {
    this.value = held
      ? THREE.MathUtils.damp(this.value, 1, this.riseRate, dt)
      : THREE.MathUtils.damp(this.value, 0, this.fallRate, dt);
    return this.value;
  }
}

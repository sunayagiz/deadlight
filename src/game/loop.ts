/** Fixed-timestep accumulator. Feed it frame time; it calls step() 0..maxSteps times. */
export class FixedLoop {
  private acc = 0;

  constructor(
    private readonly dt: number,
    private readonly maxSteps = 5,
  ) {}

  /**
   * @param elapsed seconds since last tick
   * @returns interpolation alpha in [0, 1): how far we are into the next sim tick
   */
  tick(elapsed: number, step: () => void): number {
    this.acc = Math.min(this.acc + elapsed, this.dt * this.maxSteps);
    while (this.acc >= this.dt) {
      step();
      this.acc -= this.dt;
    }
    return this.acc / this.dt;
  }
}

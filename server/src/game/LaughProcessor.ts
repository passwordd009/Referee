const COOLDOWN_MS   = 3_000;
const MIN_CONFIDENCE = 0.5;

export class LaughProcessor {
  private lastLaughAt = new Map<string, number>();

  shouldRegister(playerId: string, confidence: number): boolean {
    if (confidence < MIN_CONFIDENCE) return false;

    const last = this.lastLaughAt.get(playerId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) return false;

    this.lastLaughAt.set(playerId, Date.now());
    return true;
  }

  reset(): void {
    this.lastLaughAt.clear();
  }
}

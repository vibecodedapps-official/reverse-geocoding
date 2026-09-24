import { DurableObject } from "cloudflare:workers";

const DAY_MS = 86_400_000;
const CREATE_TABLE = "CREATE TABLE IF NOT EXISTS counts (day INTEGER PRIMARY KEY, count INTEGER NOT NULL)";

/** Per-key request counts by UTC day. One instance per key id. */
export class DailyCounter extends DurableObject {
  // deleteAll() drops the table too, and this instance can outlive it.
  private hasTable = false;

  /**
   * Counts one request on the UTC day of nowMs and reports whether the day's count is within
   * limit. The caller passes the time so every instance agrees with the Worker on the day.
   */
  async hit(nowMs: number, limit: number): Promise<boolean> {
    const day = Math.floor(nowMs / DAY_MS);
    const sql = this.ctx.storage.sql;
    // No await before the count is read, so concurrent calls cannot interleave.
    if (!this.hasTable) {
      sql.exec(CREATE_TABLE);
      this.hasTable = true;
    }
    const { count } = sql
      .exec<{ count: number }>(
        "INSERT INTO counts (day, count) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET count = count + 1 RETURNING count",
        day,
      )
      .one();
    if (count === 1) {
      sql.exec("DELETE FROM counts WHERE day < ?", day - 1);
      await this.scheduleCleanup();
    }
    return count <= limit;
  }

  /** Deletes the days before the previous UTC day, and all storage once no day is left. */
  override async alarm(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM counts WHERE day < ?", Math.floor(Date.now() / DAY_MS) - 1);
    await this.scheduleCleanup();
  }

  /** Sets the alarm for when the oldest day stops being the previous UTC day. */
  private async scheduleCleanup(): Promise<void> {
    const { oldest } = this.ctx.storage.sql.exec<{ oldest: number | null }>("SELECT MIN(day) AS oldest FROM counts").one();
    if (oldest !== null) {
      await this.ctx.storage.setAlarm((oldest + 2) * DAY_MS);
      return;
    }
    this.hasTable = false;
    await this.ctx.storage.deleteAll();
  }
}

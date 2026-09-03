const RESET_HOUR_KST = 4;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function gamePeriod(cycleType, now = new Date()) {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS - RESET_HOUR_KST * 3600000);
  let day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  if (cycleType === "Weekly") day -= ((shifted.getUTCDay() + 6) % 7) * DAY_MS;
  else if (cycleType !== "Daily") throw new Error(`unknown cycleType: ${cycleType}`);
  const start = day - KST_OFFSET_MS + RESET_HOUR_KST * 3600000;
  return {
    cycleStartedAt: new Date(start),
    nextResetAt: new Date(start + (cycleType === "Weekly" ? 7 : 1) * DAY_MS),
  };
}

module.exports = { gamePeriod, RESET_HOUR_KST };

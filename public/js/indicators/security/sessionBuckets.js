const TIME_ZONE_FORMATTERS = new Map();

function timeZoneOffsetSeconds(time, timeZone) {
  let formatter = TIME_ZONE_FORMATTERS.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      TIME_ZONE_FORMATTERS.set(timeZone, formatter);
    } catch {
      return 0;
    }
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(Number(time) * 1000)).map((part) => [part.type, part.value]),
  );
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ) / 1000;
  return localAsUtc - Number(time);
}

function sessionStartMinutes(session) {
  const match = String(session ?? "").match(/(?:^|,)(\d{2})(\d{2})-/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Align an intraday HTF bucket to the exchange session instead of UTC midnight.
 * This matches providers such as TradingView, whose CME 4h NQ bars begin at
 * 17:00 America/Chicago during the active overnight session.
 */
export function alignedHtfBucketOpen(time, tfSec, symbolInfo) {
  const sessionStart = sessionStartMinutes(symbolInfo?.session);
  if (sessionStart == null || tfSec >= 604800) {
    return Math.floor(time / tfSec) * tfSec;
  }
  const timeZone = String(symbolInfo?.timezone || "Etc/UTC");
  const offset = timeZoneOffsetSeconds(time, timeZone);
  const localTime = time + offset;
  let sessionOpen = Math.floor(localTime / 86400) * 86400 + sessionStart * 60;
  if (localTime < sessionOpen) sessionOpen -= 86400;
  const bucketLocal = sessionOpen + Math.floor((localTime - sessionOpen) / tfSec) * tfSec;
  return bucketLocal - offset;
}

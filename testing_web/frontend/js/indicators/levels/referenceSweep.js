/** Mark prior-day/week levels swept by the first crossing in this trading day. */
export function markPreviousPeriodSweeps(lines, utcBars, chartBars, range) {
  if (!range) return;
  for (const line of lines) {
    if (!(["PDH", "PDL", "PWH", "PWL"].includes(line.referenceTag))) continue;
    for (let i = range.first; i <= range.last; i += 1) {
      const bar = utcBars[i];
      if (!bar) continue;
      const crossed = line.kind === "high" ? bar.high >= line.price : bar.low <= line.price;
      if (!crossed) continue;
      line.swept = true;
      line.sweepTime = bar.time;
      line.endTime = bar.time;
      line.sweepChartTime = chartBars[i]?.time ?? bar.time;
      line.endChartTime = line.sweepChartTime;
      break;
    }
  }
}

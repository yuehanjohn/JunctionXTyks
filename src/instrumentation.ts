// Warm the stats cache at server boot so the first user request is fast.
export async function register() {
  const { getMeta, getAntibiogram, getSignals } = await import("./lib/stats");
  await Promise.all([
    getMeta(),
    getAntibiogram({ window: "4w" }),
    getAntibiogram({ window: "1y" }),
    getSignals(),
  ]).catch(() => {
    // DB may be empty/missing at boot; per-request compute still works.
  });

  // Early-warning stack: the backtest singleton (deterministic, ~20 s) and
  // the warning feed warm in the background — errors are non-fatal.
  void (async () => {
    const { getWarningFeed } = await import("./lib/warning");
    await getWarningFeed({}).catch(() => {});
  })();
}

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
}

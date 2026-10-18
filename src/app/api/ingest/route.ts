import { NextResponse } from "next/server";
import { ingestSimulated, resetSimulated } from "@/lib/ingest";
import type { IngestResetResponse, IngestResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST /api/ingest — simulate the laboratory feed landing new samples.
 *  Body: { scenario: "routine" | "outbreak", count?: number }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { scenario?: unknown; count?: unknown }
    | null;
  const scenario = body?.scenario;
  if (scenario !== "routine" && scenario !== "outbreak") {
    return NextResponse.json(
      { error: "Body must be { scenario: 'routine' | 'outbreak', count? }." },
      { status: 400 },
    );
  }
  const count = typeof body?.count === "number" ? Math.floor(body.count) : undefined;
  const response: IngestResponse = await ingestSimulated(scenario, count);
  return NextResponse.json(response);
}

/** DELETE /api/ingest — remove every simulated sample, restoring the demo dataset. */
export async function DELETE() {
  const response: IngestResetResponse = await resetSimulated();
  return NextResponse.json(response);
}

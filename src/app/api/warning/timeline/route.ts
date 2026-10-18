import { NextResponse } from "next/server";

import { getWarningTimeline } from "@/lib/warning";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const weeks = Number(params.get("weeks") ?? "");
  const response = await getWarningTimeline({
    weeks: Number.isFinite(weeks) ? weeks : undefined,
    ward: params.get("ward") ?? undefined,
    asOf: params.get("asOf") || null,
  });
  return NextResponse.json(response);
}

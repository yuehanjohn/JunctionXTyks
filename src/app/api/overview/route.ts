import { NextResponse } from "next/server";

import { getOverview } from "@/lib/pulse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const response = await getOverview({
    ward: params.get("ward") ?? undefined,
    sampleType: params.get("sample") || null,
    asOf: params.get("asOf") || null,
  });
  return NextResponse.json(response);
}

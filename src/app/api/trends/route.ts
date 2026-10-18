import { NextResponse } from "next/server";

import { getTrend } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const organism = params.get("organism");
  const antibiotic = params.get("antibiotic");
  if (!organism || !antibiotic) {
    return NextResponse.json(
      { error: "Query params 'organism' and 'antibiotic' are required." },
      { status: 400 },
    );
  }
  const response = await getTrend({
    ward: params.get("ward") ?? undefined,
    organism,
    antibiotic,
    sampleType: params.get("sample") || null,
    sex: params.get("sex") || null,
    ageBand: params.get("age") || null,
    asOf: params.get("asOf") || null,
  });
  return NextResponse.json(response);
}

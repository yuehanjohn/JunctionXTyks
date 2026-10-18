import { NextResponse } from "next/server";

import { getWardCompare } from "@/lib/pulse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const organism = params.get("organism");
  if (!organism) {
    return NextResponse.json({ error: "Missing required param: organism." }, { status: 400 });
  }
  const response = await getWardCompare({
    organism,
    antibiotic: params.get("antibiotic"),
    sampleType: params.get("sample"),
    asOf: params.get("asOf") || null,
  });
  return NextResponse.json(response);
}

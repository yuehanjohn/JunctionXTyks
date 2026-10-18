import { NextResponse } from "next/server";

import { getWardComparison } from "@/lib/pulse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const response = await getWardComparison({
    sampleType: params.get("sample") || null,
    asOf: params.get("asOf") || null,
  });
  return NextResponse.json(response);
}

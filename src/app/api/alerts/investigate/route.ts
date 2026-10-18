import { NextResponse } from "next/server";

import { getAlertInvestigation } from "@/lib/pulse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Missing required param: id (format 'ward|organism|antibiotic')." },
      { status: 400 },
    );
  }
  const response = await getAlertInvestigation({ id, asOf: params.get("asOf") || null });
  return NextResponse.json(response);
}

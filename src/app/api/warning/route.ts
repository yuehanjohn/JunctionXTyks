import { NextResponse } from "next/server";

import { getWarningFeed } from "@/lib/warning";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const response = await getWarningFeed({
    ward: params.get("ward") ?? undefined,
    asOf: params.get("asOf") || null,
  });
  return NextResponse.json(response);
}

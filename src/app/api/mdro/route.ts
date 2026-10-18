import { NextResponse } from "next/server";

import { getMdroFeed } from "@/lib/warning";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const response = await getMdroFeed({
    ward: params.get("ward") ?? undefined,
    asOf: params.get("asOf") || null,
  });
  return NextResponse.json(response);
}

import { NextResponse } from "next/server";

import { getAntibiogram } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const window = params.get("window");
  if (window !== "4w" && window !== "1y") {
    return NextResponse.json(
      { error: "Invalid window: expected '4w' or '1y'." },
      { status: 400 },
    );
  }
  const response = await getAntibiogram({
    ward: params.get("ward") ?? undefined,
    sampleType: params.get("sample") || null,
    window,
  });
  return NextResponse.json(response);
}

import { NextResponse } from "next/server";

import { getBacktest } from "@/lib/backtest";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getBacktest());
}

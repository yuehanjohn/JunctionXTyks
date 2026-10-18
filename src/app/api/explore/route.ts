import { NextResponse } from "next/server";

import { getExplore } from "@/lib/pulse";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? "");
  const response = await getExplore({
    ward: params.get("ward") ?? undefined,
    sampleType: params.get("sample"),
    organism: params.get("organism"),
    antibiotic: params.get("antibiotic"),
    result: params.get("result"),
    sex: params.get("sex"),
    ageBand: params.get("age"),
    from: params.get("from"),
    to: params.get("to"),
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
  });
  return NextResponse.json(response);
}

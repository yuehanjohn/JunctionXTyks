import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/advisor";
import type { AdvisorQuestion } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Narrow an untrusted request body to a valid AdvisorQuestion, or null. */
function parseAdvisorQuestion(body: unknown): AdvisorQuestion | null {
  if (body === null || typeof body !== "object" || !("question" in body)) return null;
  const question: unknown = body.question;
  if (typeof question !== "string" || question.trim().length === 0) return null;
  const parsed: AdvisorQuestion = { question: question.trim() };
  if ("ward" in body && typeof body.ward === "string" && body.ward.trim().length > 0) {
    parsed.ward = body.ward.trim();
  }
  return parsed;
}

/** POST /api/advisor — { question, ward? } → AdvisorResponse */
export async function POST(req: Request) {
  const body = parseAdvisorQuestion(await req.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: "Provide a `question` string." }, { status: 400 });
  }

  try {
    const response = await answerQuestion(body.question, body.ward);
    return NextResponse.json(response);
  } catch (err) {
    console.error("[api/advisor]", err);
    return NextResponse.json({ error: "Advisor failed to answer." }, { status: 500 });
  }
}

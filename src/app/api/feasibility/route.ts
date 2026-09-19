import { NextResponse } from "next/server";
import {
  getFeasibilityJob,
  startFeasibilitySearch,
  type SearchMode,
} from "@/lib/feasibility";

function optionalDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function mode(value: unknown): SearchMode {
  return value === "KNOWN_DATE" ? "KNOWN_DATE" : "FLEXIBLE_DATE";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      sourceStations,
      destinationStations,
      departureDate,
      expectedReturnDate,
      classCode = "ANY",
      quotaCode = "GN",
      mode: requestedMode,
    } = body ?? {};

    if (
      !Array.isArray(sourceStations) ||
      sourceStations.length === 0 ||
      !Array.isArray(destinationStations) ||
      destinationStations.length === 0 ||
      typeof departureDate !== "string" ||
      !departureDate.trim()
    ) {
      return NextResponse.json(
        { success: false, error: "From, To and departure date are required." },
        { status: 400 },
      );
    }

    const normalizedClassCode =
      typeof classCode === "string" && classCode.trim()
        ? classCode.trim().toUpperCase()
        : "ANY";

    const normalizedQuotaCode =
      typeof quotaCode === "string" && quotaCode.trim()
        ? quotaCode.trim().toUpperCase()
        : "GN";

    const job = startFeasibilitySearch({
      sourceStations,
      destinationStations,
      departureDate: departureDate.trim(),
      expectedReturnDate: optionalDate(expectedReturnDate),
      classCode: normalizedClassCode,
      quotaCode: normalizedQuotaCode,
      mode: mode(requestedMode),
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      data: job.data,
    });
  } catch (error) {
    console.error("Feasibility start error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unable to start the search.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("jobId");

  if (!id) {
    return NextResponse.json(
      { success: false, error: "jobId is required." },
      { status: 400 },
    );
  }

  const job = getFeasibilityJob(id);

  if (!job) {
    return NextResponse.json(
      { success: false, error: "Search job not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    data: job.data,
  });
}

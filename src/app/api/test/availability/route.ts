import { NextResponse } from "next/server";
import { getTrainAvailability } from "@/lib/railradar";

export async function GET() {
  try {
    const data = await getTrainAvailability({
      trainNumber: "12952",
      source: "NDLS",
      destination: "MMCT",
      journeyDate: "2026-09-10",
      classCode: "3A",
      quotaCode: "GN",
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Availability test failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";
import { searchStations } from "@/lib/railradar";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";

    if (query.length < 2) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const stations = await searchStations(query);

    return NextResponse.json({
      success: true,
      data: stations,
    });
  } catch (error) {
    console.error("Station search error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Station search failed.",
      },
      { status: 500 }
    );
  }
}
import { spawn } from "child_process";
import path from "path";

export type DiscoveredTrain = {
  trainNumber: string;
  trainName?: string;
  source?: string;
  destination?: string;
  sourceName?: string;
  destinationName?: string;
  fromStation?: string;
  toStation?: string;
  fromStationName?: string;
  toStationName?: string;
  departureTime?: string;
  arrivalTime?: string;
  travelTime?: string;
  classes?: string;
  runningDays?: string;
  trainType?: string;
  journeyDate?: string;
};

export type TrainsOnDatesInput = {
  sources: string[];
  destinations: string[];
  dates: string[];
};

export type TrainsOnDatesResult = {
  dates: Record<string, DiscoveredTrain[]>;
  scheduleFiles?: number;
};

const BRIDGE_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "railway",
  "ntes_bridge.py"
);

function runBridge(command: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "python" : "python3",
      [BRIDGE_SCRIPT, command, ...args],
      {
        cwd: process.cwd(),
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));

    child.on("close", (code) => {
      const trimmed = stdout.trim();

      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              `NTES bridge exited with code ${code}.`
          )
        );
        return;
      }

      if (!trimmed) {
        reject(
          new Error(
            `NTES bridge exited successfully but returned no JSON. ${
              stderr.trim() || ""
            }`.trim()
          )
        );
        return;
      }

      try {
        const result = JSON.parse(trimmed);

        if (!result.success) {
          reject(
            new Error(
              result.error || "NTES bridge returned an error."
            )
          );
          return;
        }

        resolve(result);
      } catch {
        reject(
          new Error(
            `Invalid NTES bridge response: ${trimmed.slice(0, 500)}`
          )
        );
      }
    });
  });
}

export async function getTrainsOnDates(
  input: TrainsOnDatesInput
): Promise<TrainsOnDatesResult> {
  const sources = Array.from(
    new Set(input.sources.map((value) => value.trim().toUpperCase()).filter(Boolean))
  );
  const destinations = Array.from(
    new Set(
      input.destinations
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    )
  );
  const dates = Array.from(
    new Set(input.dates.map((value) => value.trim()).filter(Boolean))
  );

  if (!sources.length || !destinations.length || !dates.length) {
    throw new Error("sources, destinations and dates are required.");
  }

  const result = (await runBridge("trains_on_dates", [
    JSON.stringify({ sources, destinations, dates }),
  ])) as {
    dates?: Record<string, DiscoveredTrain[]>;
    scheduleFiles?: number;
  };

  return {
    dates: result.dates ?? Object.fromEntries(dates.map((date) => [date, []])),
    scheduleFiles: result.scheduleFiles,
  };
}

export async function getTrainsBetween(
  source: string,
  destination: string
): Promise<DiscoveredTrain[]> {
  const result = await runBridge("trains_between", [
    source,
    destination,
  ]);

  return result.trains ?? [];
}

export async function getTrainSchedule(
  trainNumber: string,
  startDate?: string
): Promise<unknown> {
  return runBridge(
    "schedule",
    startDate ? [trainNumber, startDate] : [trainNumber]
  );
}

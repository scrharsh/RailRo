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
  success: boolean;
  dates: Record<string, DiscoveredTrain[]>;
  scheduleFiles?: number;
};

const BRIDGE_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "railway",
  "ntes_bridge.py"
);

function runBridge(
  command: string,
  args: string[]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [BRIDGE_SCRIPT, command, ...args],
      {
        cwd: process.cwd(),
        windowsHide: true,

        /*
         * Explicitly provide UTF-8 streams.
         * This is important because railway station/train data
         * can contain Hindi/non-ASCII text.
         */
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start NTES bridge: ${error.message}`
        )
      );
    });

    child.on("close", (code, signal) => {
      const cleanStdout = stdout.trim();
      const cleanStderr = stderr.trim();

      if (code !== 0) {
        reject(
          new Error(
            [
              `NTES bridge exited with code ${code}.`,
              signal
                ? `Signal: ${signal}.`
                : "",
              cleanStderr
                ? `Python error: ${cleanStderr}`
                : "",
              cleanStdout
                ? `Python output: ${cleanStdout}`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          )
        );

        return;
      }

      /*
       * Python may sometimes write diagnostic output to stderr
       * even when the command succeeds.
       *
       * Do NOT treat stderr as the response.
       */

      if (!cleanStdout) {
        reject(
          new Error(
            [
              "NTES bridge exited successfully but returned no JSON.",
              cleanStderr
                ? `Python stderr: ${cleanStderr}`
                : "Python stderr was also empty.",
              `Command: ${command}`,
            ].join(" ")
          )
        );

        return;
      }

      try {
        const result =
          JSON.parse(cleanStdout);

        if (!result.success) {
          reject(
            new Error(
              result.error ||
                "NTES bridge returned an error."
            )
          );

          return;
        }

        resolve(result);
      } catch (error) {
        reject(
          new Error(
            [
              "Invalid NTES bridge JSON response.",
              `Command: ${command}`,
              `Output: ${cleanStdout.slice(0, 2000)}`,
              cleanStderr
                ? `Python stderr: ${cleanStderr.slice(0, 2000)}`
                : "",
            ]
              .filter(Boolean)
              .join(" ")
          )
        );
      }
    });
  });
}

/**
 * Legacy station-to-station discovery.
 *
 * Kept for compatibility.
 */
export async function getTrainsBetween(
  source: string,
  destination: string
): Promise<DiscoveredTrain[]> {
  const result =
    (await runBridge(
      "trains_between",
      [source, destination]
    )) as {
      trains?: DiscoveredTrain[];
    };

  return result.trains ?? [];
}

/**
 * DATE-FIRST TRAIN DISCOVERY
 *
 * Finds only trains that actually operate on the
 * requested dates between the requested station groups.
 */
export async function getTrainsOnDates(
  input: TrainsOnDatesInput
): Promise<TrainsOnDatesResult> {
  const sources = [
    ...new Set(
      input.sources
        .map(normalizeCode)
        .filter(Boolean)
    ),
  ];

  const destinations = [
    ...new Set(
      input.destinations
        .map(normalizeCode)
        .filter(Boolean)
    ),
  ];

  const dates = [
    ...new Set(
      input.dates
        .map((date) => date.trim())
        .filter(Boolean)
    ),
  ];

  if (
    sources.length === 0 ||
    destinations.length === 0 ||
    dates.length === 0
  ) {
    return {
      success: true,
      dates: {},
    };
  }

  const payload = JSON.stringify({
    sources,
    destinations,
    dates,
  });

  const result =
    (await runBridge(
      "trains_on_dates",
      [payload]
    )) as {
      success: boolean;
      dates?: Record<
        string,
        DiscoveredTrain[]
      >;
      scheduleFiles?: number;
    };

  return {
    success: result.success,
    dates: result.dates ?? {},
    scheduleFiles:
      result.scheduleFiles,
  };
}

export async function getTrainSchedule(
  trainNumber: string,
  startDate?: string
): Promise<unknown> {
  return runBridge(
    "schedule",
    startDate
      ? [trainNumber, startDate]
      : [trainNumber]
  );
}

function normalizeCode(
  value: string
): string {
  return value
    .trim()
    .toUpperCase();
}
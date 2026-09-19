import fs from "node:fs";
import path from "node:path";

const RAILRADAR_BASE_URL = "https://api.railradar.in/v1";

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

export type RailRadarAvailabilityDay = {
  date: string;
  rawDate?: string;
  status: string;
  statusCode: string;
  isAvailable: boolean;
  availableSeats?: number;
  waitlistNumber?: number;
  waitlistType?: string;
};

type RailRadarResponse = {
  success: boolean;
  data?: {
    trainNumber: string;
    trainName: string;
    quotaCode: string;
    classCode: string;

    calendar?: Array<{
      date: string;
      rawDate?: string;
      status: string;
    }>;

    avlDayList?: Array<{
      availablityDate: string;
      availablityStatus: string;
    }>;
  };

  error?: {
    code?: string;
    message?: string;
  };
};

/* -------------------------------------------------------------------------- */
/* Stations                                                                   */
/* -------------------------------------------------------------------------- */

export type RailRadarStation = {
  code: string;
  name: string;
  city?: string;
  state?: string;
};

type LocalStationRecord = {
  code?: string;
  stationCode?: string;
  name?: string;
  stationName?: string;
  city?: string;
  cityName?: string;
  state?: string;
  stateName?: string;
};

/* -------------------------------------------------------------------------- */
/* Availability helpers                                                       */
/* -------------------------------------------------------------------------- */

function parseAvailabilityStatus(status: string): {
  status: string;
  statusCode: string;
  isAvailable: boolean;
  availableSeats?: number;
  waitlistNumber?: number;
} {
  const normalized = status.trim().toUpperCase();

  const availableMatch =
    normalized.match(/^AVAILABLE-(\d+)$/);

  if (availableMatch) {
    return {
      status: normalized,
      statusCode: "AVAILABLE",
      isAvailable: true,
      availableSeats: Number(availableMatch[1]),
    };
  }

  const racMatch =
    normalized.match(/^RAC\s*(\d+)?/);

  if (racMatch) {
    return {
      status: normalized,
      statusCode: "RAC",
      isAvailable: false,
      waitlistNumber: racMatch[1]
        ? Number(racMatch[1])
        : undefined,
    };
  }

  const waitlistMatch =
    normalized.match(
      /(?:GNWL|RLWL|PQWL|RLGN|WL)\s*(\d+)/
    );

  if (waitlistMatch) {
    return {
      status: normalized,
      statusCode: "WAITLIST",
      isAvailable: false,
      waitlistNumber: Number(
        waitlistMatch[1]
      ),
    };
  }

  return {
    status: normalized,
    statusCode: normalized,
    isAvailable: false,
  };
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
  ) {
    return trimmed;
  }

  const match = trimmed.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/
  );

  if (match) {
    const [, day, month, year] = match;

    return [
      year,
      month.padStart(2, "0"),
      day.padStart(2, "0"),
    ].join("-");
  }

  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* Live RailRadar availability                                                */
/* -------------------------------------------------------------------------- */

/**
 * Get live seat availability for one train segment.
 *
 * RailRadar is intentionally used only for live availability.
 *
 * Station autocomplete does NOT use RailRadar.
 */
export async function getTrainAvailability(params: {
  trainNumber: string;
  source: string;
  destination: string;
  journeyDate: string;
  classCode: string;
  quotaCode?: string;
}): Promise<{
  trainNumber: string;
  trainName: string;
  quotaCode: string;
  classCode: string;
  calendar: RailRadarAvailabilityDay[];
}> {
  const apiKey =
    process.env.RAILRADAR_API_KEY;

  if (!apiKey) {
    throw new Error(
      "RAILRADAR_API_KEY is not configured in .env"
    );
  }

  const searchParams =
    new URLSearchParams({
      journeyDate: params.journeyDate,
      source:
        params.source.toUpperCase(),
      destination:
        params.destination.toUpperCase(),
      classCode:
        params.classCode.toUpperCase(),
      quotaCode: (
        params.quotaCode ?? "GN"
      ).toUpperCase(),
    });

  const url =
    `${RAILRADAR_BASE_URL}/trains/` +
    `${encodeURIComponent(params.trainNumber)}` +
    `/seats?${searchParams.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  let result: RailRadarResponse;

  try {
    result =
      (await response.json()) as RailRadarResponse;
  } catch {
    throw new Error(
      `RailRadar returned an invalid response (${response.status})`
    );
  }

  if (
    !response.ok ||
    !result.success ||
    !result.data
  ) {
    if (response.status === 401) {
      throw new Error(
        "RailRadar authentication failed. Check RAILRADAR_API_KEY."
      );
    }

    if (response.status === 429) {
      throw new Error(
        "RailRadar rate limit reached. Please wait before searching again."
      );
    }

    throw new Error(
      result.error?.message ??
        `RailRadar request failed (${response.status})`
    );
  }

  const calendar: RailRadarAvailabilityDay[] =
    [];

  for (
    const entry of result.data.calendar ?? []
  ) {
    const parsed =
      parseAvailabilityStatus(
        entry.status
      );

    calendar.push({
      date: normalizeDate(entry.date),
      rawDate: entry.rawDate,
      status: parsed.status,
      statusCode: parsed.statusCode,
      isAvailable: parsed.isAvailable,
      availableSeats:
        parsed.availableSeats,
      waitlistNumber:
        parsed.waitlistNumber,
    });
  }

  for (
    const entry of result.data.avlDayList ?? []
  ) {
    const date = normalizeDate(
      entry.availablityDate
    );

    if (
      calendar.some(
        (existing) =>
          existing.date === date
      )
    ) {
      continue;
    }

    const parsed =
      parseAvailabilityStatus(
        entry.availablityStatus
      );

    calendar.push({
      date,
      rawDate:
        entry.availablityDate,
      status: parsed.status,
      statusCode: parsed.statusCode,
      isAvailable: parsed.isAvailable,
      availableSeats:
        parsed.availableSeats,
      waitlistNumber:
        parsed.waitlistNumber,
    });
  }

  return {
    trainNumber:
      result.data.trainNumber,
    trainName:
      result.data.trainName,
    quotaCode:
      result.data.quotaCode,
    classCode:
      result.data.classCode,
    calendar,
  };
}

/* -------------------------------------------------------------------------- */
/* Local station master                                                       */
/* -------------------------------------------------------------------------- */

function clean(value: unknown): string {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function normalizeStation(
  station: LocalStationRecord
): RailRadarStation | null {
  const code = clean(
    station.code ??
      station.stationCode
  ).toUpperCase();

  const name = clean(
    station.name ??
      station.stationName
  );

  const city = clean(
    station.city ??
      station.cityName
  );

  const state = clean(
    station.state ??
      station.stateName
  );

  if (!code || !name) {
    return null;
  }

  return {
    code,
    name,
    city: city || undefined,
    state: state || undefined,
  };
}

function deduplicateStations(
  stations: RailRadarStation[]
): RailRadarStation[] {
  const result: RailRadarStation[] = [];
  const seen = new Set<string>();

  for (const station of stations) {
    const key =
      station.code.toUpperCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(station);
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Station master file discovery                                              */
/* -------------------------------------------------------------------------- */

/**
 * The exporter creates the station master here:
 *
 *   data/railpull/data/out/stations.json
 *
 * This file is derived from the real NTES timetable schedules.
 *
 * We deliberately DO NOT use:
 *
 *   data/railpull/ntes/major_stations.json
 *
 * because that is only a partial list.
 *
 * We also do not call RailRadar as a fallback. The application must not
 * silently switch to an external station source and consume API quota when
 * the local railway master is unavailable.
 */
function getStationMasterPaths(): string[] {
  const cwd = process.cwd();

  return [
    path.join(
      cwd,
      "data",
      "railpull",
      "data",
      "out",
      "stations.json"
    ),

    // Optional future project-level generated dataset.
    path.join(
      cwd,
      "data",
      "raw",
      "stations.json"
    ),

    // Optional future location.
    path.join(
      cwd,
      "data",
      "stations.json"
    ),
  ];
}

function parseStationFile(
  filePath: string
): RailRadarStation[] {
  try {
    const raw =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    const parsed: unknown =
      JSON.parse(raw);

    let records: unknown[] = [];

    if (Array.isArray(parsed)) {
      records = parsed;
    } else if (
      parsed &&
      typeof parsed === "object"
    ) {
      const object =
        parsed as Record<
          string,
          unknown
        >;

      if (
        Array.isArray(
          object.stations
        )
      ) {
        records =
          object.stations;
      } else if (
        Array.isArray(
          object.data
        )
      ) {
        records =
          object.data;
      }
    }

    const normalized =
      records
        .filter(
          (
            record
          ): record is LocalStationRecord =>
            Boolean(
              record &&
                typeof record ===
                  "object"
            )
        )
        .map(normalizeStation)
        .filter(
          (
            station
          ): station is RailRadarStation =>
            station !== null
        );

    return deduplicateStations(
      normalized
    );
  } catch (error) {
    console.warn(
      `Unable to read station master: ${filePath}`,
      error
    );

    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Station cache                                                              */
/* -------------------------------------------------------------------------- */

let localStationCache:
  | RailRadarStation[]
  | null = null;

function loadLocalStations(): RailRadarStation[] {
  const paths =
    getStationMasterPaths();

  for (const filePath of paths) {
    if (
      !fs.existsSync(filePath)
    ) {
      continue;
    }

    const stations =
      parseStationFile(
        filePath
      );

    if (stations.length > 0) {
      console.log(
        `Loaded ${stations.length} stations from ${filePath}`
      );

      return stations;
    }
  }

  return [];
}

function getLocalStations(): RailRadarStation[] {
  if (
    localStationCache !== null
  ) {
    return localStationCache;
  }

  localStationCache =
    loadLocalStations();

  return localStationCache;
}

/**
 * Clear the in-process station cache.
 *
 * Useful during development after regenerating stations.json without
 * restarting the Next.js server.
 */
export function clearStationCache(): void {
  localStationCache = null;
}

/* -------------------------------------------------------------------------- */
/* Local station search                                                       */
/* -------------------------------------------------------------------------- */

function searchLocalStations(
  query: string
): RailRadarStation[] {
  const stations =
    getLocalStations();

  if (stations.length === 0) {
    return [];
  }

  const normalizedQuery =
    query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const exactCodeMatches: RailRadarStation[] =
    [];

  const exactNameMatches: RailRadarStation[] =
    [];

  const exactCityMatches: RailRadarStation[] =
    [];

  const prefixMatches: RailRadarStation[] =
    [];

  const substringMatches: RailRadarStation[] =
    [];

  for (const station of stations) {
    const code =
      station.code.toLowerCase();

    const name =
      station.name.toLowerCase();

    const city =
      station.city?.toLowerCase() ??
      "";

    if (
      code === normalizedQuery
    ) {
      exactCodeMatches.push(
        station
      );
      continue;
    }

    if (
      name === normalizedQuery
    ) {
      exactNameMatches.push(
        station
      );
      continue;
    }

    if (
      city === normalizedQuery
    ) {
      exactCityMatches.push(
        station
      );
      continue;
    }

    if (
      code.startsWith(
        normalizedQuery
      ) ||
      name.startsWith(
        normalizedQuery
      ) ||
      city.startsWith(
        normalizedQuery
      )
    ) {
      prefixMatches.push(
        station
      );
      continue;
    }

    if (
      code.includes(
        normalizedQuery
      ) ||
      name.includes(
        normalizedQuery
      ) ||
      city.includes(
        normalizedQuery
      )
    ) {
      substringMatches.push(
        station
      );
    }
  }

  return deduplicateStations([
    ...exactCodeMatches,
    ...exactNameMatches,
    ...exactCityMatches,
    ...prefixMatches,
    ...substringMatches,
  ]).slice(0, 20);
}

/* -------------------------------------------------------------------------- */
/* Public station search                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Search the local NTES-derived railway station master.
 *
 * RailRadar is NEVER called for station autocomplete.
 */
export async function searchStations(
  query: string
): Promise<RailRadarStation[]> {
  const trimmed =
    query.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const stations =
    getLocalStations();

  if (stations.length === 0) {
    throw new Error(
      "Railway station master is not available. " +
        "Run the NTES timetable crawler and " +
        "`python data\\railpull\\transform\\export.py` first."
    );
  }

  return searchLocalStations(
    trimmed
  );
}
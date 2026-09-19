import {
  DiscoveredTrain,
  getTrainsOnDates,
} from "./ntes";

import {
  getTrainAvailability,
} from "./railradar";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type StationRef = {
  code: string;
  name: string;
  city?: string;
};

export type DateRangeFeasibilityInput = {
  sourceStations: StationRef[];
  destinationStations: StationRef[];

  departureStartDate: string;
  departureEndDate: string;

  stayDays: number;

  classCode: string;
  quotaCode: string;
};

export type FeasibleTrain = {
  trainNumber: string;
  trainName?: string;

  sourceStation: string;
  sourceStationName?: string;

  destinationStation: string;
  destinationStationName?: string;

  departureTime?: string;
  arrivalTime?: string;
  travelTime?: string;

  availableSeats?: number;
  status: string;
};

export type DateFeasibilityResult = {
  departureDate: string;
  returnDate: string;

  feasible: boolean;

  outboundOptions: FeasibleTrain[];
  returnOptions: FeasibleTrain[];

  outboundChecked: number;
  returnChecked: number;

  error?: string;
};

export type DateRangeFeasibilityResult = {
  results: DateFeasibilityResult[];
};

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * RailRadar sandbox/free access is rate limited.
 *
 * Keep requests comfortably below the documented limit.
 */
const RAILRADAR_DELAY_MS = 6500;

/**
 * We only need to establish feasibility.
 *
 * There is no reason to check hundreds of trains once a confirmed
 * outbound/return option has already been found.
 */
const MAX_AVAILABILITY_CHECKS_PER_DIRECTION = 5;

/* -------------------------------------------------------------------------- */
/* Availability cache                                                         */
/* -------------------------------------------------------------------------- */

/**
 * IMPORTANT:
 *
 * journeyDate is part of the cache key.
 *
 * Availability for:
 *   12952 / NDLS / MMCT / 3A / GN / 2026-09-16
 *
 * must NEVER be reused for:
 *   12952 / NDLS / MMCT / 3A / GN / 2026-09-17
 */
const availabilityCache = new Map<
  string,
  AvailabilityResult
>();

let lastRailRadarRequestAt = 0;

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function checkDateRangeFeasibility(
  input: DateRangeFeasibilityInput
): Promise<DateRangeFeasibilityResult> {
  validateInput(input);

  const departureDates = getDateRange(
    input.departureStartDate,
    input.departureEndDate
  );

  if (departureDates.length === 0) {
    return {
      results: [],
    };
  }

  const returnDates = departureDates.map((date) =>
    addDays(date, input.stayDays)
  );

  const sourceCodes = uniqueCodes(
    input.sourceStations
  );

  const destinationCodes = uniqueCodes(
    input.destinationStations
  );

  /*
   * DATE-FIRST DISCOVERY
   *
   * Instead of:
   *
   *   station pair
   *      -> all trains
   *          -> then inspect dates
   *
   * we now do:
   *
   *   requested dates
   *      -> trains actually operating on those dates
   *          -> then live availability
   *
   * This prevents trains which do not operate on the selected
   * journey date from reaching RailRadar.
   */

  console.log("");
  console.log(
    "================================================="
  );
  console.log(
    "ROUND-TRIP FEASIBILITY SEARCH"
  );
  console.log(
    "================================================="
  );

  console.log(
    `Departure dates: ${departureDates[0]} → ${
      departureDates[departureDates.length - 1]
    }`
  );

  console.log(
    `Stay: ${input.stayDays} day(s)`
  );

  console.log(
    `Source stations: ${sourceCodes.join(", ")}`
  );

  console.log(
    `Destination stations: ${destinationCodes.join(", ")}`
  );

  /*
   * One NTES scan for all outbound dates.
   */
  console.log("");
  console.log(
    "Discovering outbound trains by exact date..."
  );

  const outboundDiscovery =
    await getTrainsOnDates({
      sources: sourceCodes,
      destinations: destinationCodes,
      dates: departureDates,
    });

  /*
   * One NTES scan for all return dates.
   *
   * Return route is intentionally discovered independently.
   *
   * This means:
   *
   * Delhi → Mumbai
   *
   * does NOT force:
   *
   * Mumbai → Delhi
   *
   * to use the reverse of the exact same station pair.
   */
  console.log(
    "Discovering return trains by exact date..."
  );

  const returnDiscovery =
    await getTrainsOnDates({
      sources: destinationCodes,
      destinations: sourceCodes,
      dates: returnDates,
    });

  console.log("");
  console.log(
    `Outbound schedule files scanned: ${
      outboundDiscovery.scheduleFiles ?? "unknown"
    }`
  );

  console.log(
    `Return schedule files scanned: ${
      returnDiscovery.scheduleFiles ?? "unknown"
    }`
  );

  const results: DateFeasibilityResult[] = [];

  /*
   * Evaluate every departure date independently.
   */
  for (const departureDate of departureDates) {
    const returnDate = addDays(
      departureDate,
      input.stayDays
    );

    console.log("");
    console.log(
      "-------------------------------------------------"
    );

    console.log(
      `Checking trip: ${departureDate} → ${returnDate}`
    );

    /*
     * Exact-date candidates only.
     */
    const outboundCandidates =
      normalizeDateCandidates(
        outboundDiscovery.dates[departureDate] ?? [],
        departureDate,
        input.classCode
      );

    const returnCandidates =
      normalizeDateCandidates(
        returnDiscovery.dates[returnDate] ?? [],
        returnDate,
        input.classCode
      );

    console.log(
      `Outbound candidates for ${departureDate}: ${outboundCandidates.length}`
    );

    console.log(
      `Return candidates for ${returnDate}: ${returnCandidates.length}`
    );

    /*
     * ---------------------------------------------------------------
     * STEP 1 — CHECK OUTBOUND
     * ---------------------------------------------------------------
     */

    const outboundOptions: FeasibleTrain[] = [];

    let outboundChecked = 0;

    for (
      const candidate of outboundCandidates
    ) {
      if (
        outboundChecked >=
        MAX_AVAILABILITY_CHECKS_PER_DIRECTION
      ) {
        break;
      }

      try {
        const availability =
          await getCachedAvailability({
            train: candidate,
            journeyDate: departureDate,
            classCode: input.classCode,
            quotaCode: input.quotaCode,
          });

        outboundChecked++;

        const feasible =
          isConfirmedAvailability(
            availability,
            departureDate
          );

        if (!feasible) {
          continue;
        }

        outboundOptions.push(
          toFeasibleTrain(
            candidate,
            availability
          )
        );

        /*
         * One confirmed outbound is enough to establish
         * that this departure date has an outbound option.
         */
        break;
      } catch (error) {
        /*
         * Provider coverage errors for an individual train
         * should not destroy the entire date search.
         *
         * Rate-limit errors are different and are propagated.
         */
        if (isRateLimitError(error)) {
          throw error;
        }

        if (isProviderCoverageError(error)) {
          console.warn(
            `Skipping outbound ${candidate.trainNumber}: ${
              getErrorMessage(error)
            }`
          );
          continue;
        }

        /*
         * Unknown provider errors are also skipped for the
         * individual candidate. Another real train may work.
         */
        console.warn(
          `Skipping outbound ${candidate.trainNumber}: ${
            getErrorMessage(error)
          }`
        );
      }
    }

    /*
     * If no confirmed outbound exists, there is no point
     * querying return availability.
     *
     * This is important both logically and for API quota.
     */
    if (outboundOptions.length === 0) {
      console.log(
        `No confirmed outbound availability for ${departureDate}.`
      );

      results.push({
        departureDate,
        returnDate,
        feasible: false,

        outboundOptions: [],
        returnOptions: [],

        outboundChecked,
        returnChecked: 0,
      });

      continue;
    }

    console.log(
      `Confirmed outbound found: ${outboundOptions[0].trainNumber}`
    );

    /*
     * ---------------------------------------------------------------
     * STEP 2 — CHECK RETURN
     * ---------------------------------------------------------------
     */

    const returnOptions: FeasibleTrain[] = [];

    let returnChecked = 0;

    for (
      const candidate of returnCandidates
    ) {
      if (
        returnChecked >=
        MAX_AVAILABILITY_CHECKS_PER_DIRECTION
      ) {
        break;
      }

      try {
        const availability =
          await getCachedAvailability({
            train: candidate,
            journeyDate: returnDate,
            classCode: input.classCode,
            quotaCode: input.quotaCode,
          });

        returnChecked++;

        const feasible =
          isConfirmedAvailability(
            availability,
            returnDate
          );

        if (!feasible) {
          continue;
        }

        returnOptions.push(
          toFeasibleTrain(
            candidate,
            availability
          )
        );

        /*
         * One confirmed return is enough.
         */
        break;
      } catch (error) {
        if (isRateLimitError(error)) {
          throw error;
        }

        if (isProviderCoverageError(error)) {
          console.warn(
            `Skipping return ${candidate.trainNumber}: ${
              getErrorMessage(error)
            }`
          );
          continue;
        }

        console.warn(
          `Skipping return ${candidate.trainNumber}: ${
            getErrorMessage(error)
          }`
        );
      }
    }

    const feasible =
      outboundOptions.length > 0 &&
      returnOptions.length > 0;

    console.log(
      feasible
        ? `✓ FEASIBLE: ${departureDate} → ${returnDate}`
        : `✗ NOT FEASIBLE: ${departureDate} → ${returnDate}`
    );

    if (returnOptions.length > 0) {
      console.log(
        `Confirmed return found: ${returnOptions[0].trainNumber}`
      );
    } else {
      console.log(
        `No confirmed return availability for ${returnDate}.`
      );
    }

    results.push({
      departureDate,
      returnDate,
      feasible,

      outboundOptions,
      returnOptions,

      outboundChecked,
      returnChecked,
    });
  }

  console.log("");
  console.log(
    "================================================="
  );
  console.log("FEASIBILITY SEARCH COMPLETE");
  console.log(
    "================================================="
  );

  return {
    results,
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate discovery / filtering                                            */
/* -------------------------------------------------------------------------- */

function normalizeDateCandidates(
  trains: DiscoveredTrain[],
  journeyDate: string,
  classCode: string
): DiscoveredTrain[] {
  const normalizedClass =
    classCode.trim().toUpperCase();

  const seen = new Set<string>();

  const candidates: DiscoveredTrain[] = [];

  for (const train of trains) {
    const trainNumber =
      train.trainNumber?.trim();

    if (!trainNumber) {
      continue;
    }

    /*
     * Exact date is already guaranteed by the NTES bridge.
     *
     * Keep this check as a defensive guard.
     */
    if (
      train.journeyDate &&
      normalizeDate(train.journeyDate) !==
        journeyDate
    ) {
      continue;
    }

    /*
     * If NTES has class metadata, use it.
     *
     * Missing metadata must NOT eliminate the train,
     * because availability provider may still know whether
     * the requested class is valid.
     */
    if (
      train.classes &&
      !classMatches(
        train.classes,
        normalizedClass
      )
    ) {
      continue;
    }

    const from =
      train.fromStation?.trim().toUpperCase() ?? "";

    const to =
      train.toStation?.trim().toUpperCase() ?? "";

    /*
     * Same train number can appear in multiple station
     * segments. The actual segment matters.
     */
    const key = [
      trainNumber,
      from,
      to,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(train);
  }

  /*
   * Prefer earlier departure times.
   *
   * This also makes the engine deterministic.
   */
  candidates.sort(compareDepartureTime);

  return candidates;
}

function classMatches(
  classes: string,
  requestedClass: string
): boolean {
  const normalized = classes
    .toUpperCase()
    .replace(/[,/|]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return normalized.includes(
    requestedClass
  );
}

/* -------------------------------------------------------------------------- */
/* RailRadar availability                                                      */
/* -------------------------------------------------------------------------- */

type AvailabilityResult =
  Awaited<
    ReturnType<typeof getTrainAvailability>
  >;

async function getCachedAvailability(params: {
  train: DiscoveredTrain;
  journeyDate: string;
  classCode: string;
  quotaCode: string;
}): Promise<AvailabilityResult> {
  const key = buildAvailabilityCacheKey(
    params
  );

  const cached =
    availabilityCache.get(key);

  if (cached) {
    return cached;
  }

  await waitForRailRadar();

  const result =
    await getTrainAvailability({
      trainNumber:
        params.train.trainNumber,

      source:
        params.train.fromStation ??
        params.train.source ??
        "",

      destination:
        params.train.toStation ??
        params.train.destination ??
        "",

      classCode:
        params.classCode,

      quotaCode:
        params.quotaCode,

      journeyDate:
        params.journeyDate,
    });

  availabilityCache.set(
    key,
    result
  );

  return result;
}

function buildAvailabilityCacheKey(params: {
  train: DiscoveredTrain;
  journeyDate: string;
  classCode: string;
  quotaCode: string;
}): string {
  return [
    params.train.trainNumber,
    (
      params.train.fromStation ??
      params.train.source ??
      ""
    ).toUpperCase(),
    (
      params.train.toStation ??
      params.train.destination ??
      ""
    ).toUpperCase(),
    params.classCode.toUpperCase(),
    params.quotaCode.toUpperCase(),

    /*
     * DO NOT REMOVE THIS.
     */
    params.journeyDate,
  ].join("|");
}

async function waitForRailRadar(): Promise<void> {
  const now = Date.now();

  const elapsed =
    now - lastRailRadarRequestAt;

  if (
    lastRailRadarRequestAt > 0 &&
    elapsed < RAILRADAR_DELAY_MS
  ) {
    await sleep(
      RAILRADAR_DELAY_MS - elapsed
    );
  }

  lastRailRadarRequestAt =
    Date.now();
}

/* -------------------------------------------------------------------------- */
/* Availability interpretation                                                */
/* -------------------------------------------------------------------------- */

function isConfirmedAvailability(
  availability: AvailabilityResult,
  journeyDate: string
): boolean {
  const calendar =
    getAvailabilityCalendar(
      availability
    );

  if (calendar.length === 0) {
    return false;
  }

  /*
   * RailRadar can return several calendar days.
   *
   * We only care about the exact requested journey date.
   */
  const exactDays =
    calendar.filter((day) =>
      availabilityDayMatchesDate(
        day,
        journeyDate
      )
    );

  /*
   * If the provider did not expose a date field,
   * getTrainAvailability() is expected to have already
   * normalized the requested journey date into the result.
   *
   * In that case, use the first returned day.
   */
  const days =
    exactDays.length > 0
      ? exactDays
      : calendar.length === 1
        ? calendar
        : [];

  for (const day of days) {
    const statusCode =
      String(
        day.statusCode ?? ""
      ).toUpperCase();

    const status =
      String(
        day.status ?? ""
      ).toUpperCase();

    /*
     * Confirmed availability only.
     *
     * AVAILABLE-0015
     * AVAILABLE-0028
     * AVAILABLE
     *
     * are accepted.
     *
     * RAC and WL are deliberately NOT accepted.
     */
    if (
      statusCode === "AVAILABLE" ||
      status.startsWith("AVAILABLE")
    ) {
      return true;
    }

    /*
     * Some RailRadar responses can expose availability
     * through isAvailable.
     */
    if (
      day.isAvailable === true &&
      !statusCode.includes("RAC") &&
      !statusCode.includes("WL") &&
      !status.includes("RAC") &&
      !status.includes("WL")
    ) {
      return true;
    }
  }

  return false;
}

function getAvailabilityCalendar(
  availability: AvailabilityResult
): AvailabilityDay[] {
  const value =
    availability as unknown as {
      calendar?: unknown;
      avlDayList?: unknown;
    };

  if (Array.isArray(value.calendar)) {
    return value.calendar as AvailabilityDay[];
  }

  if (Array.isArray(value.avlDayList)) {
    return value.avlDayList as AvailabilityDay[];
  }

  return [];
}

type AvailabilityDay = {
  date?: string;
  journeyDate?: string;
  rawDate?: string;

  status?: string;
  statusCode?: string;

  isAvailable?: boolean;

  availableSeats?: number;
};

function availabilityDayMatchesDate(
  day: AvailabilityDay,
  journeyDate: string
): boolean {
  const values = [
    day.date,
    day.journeyDate,
    day.rawDate,
  ].filter(Boolean) as string[];

  if (values.length === 0) {
    return false;
  }

  return values.some(
    (value) =>
      normalizeDate(value) ===
      journeyDate
  );
}

/* -------------------------------------------------------------------------- */
/* Convert provider result to application result                              */
/* -------------------------------------------------------------------------- */

function toFeasibleTrain(
  train: DiscoveredTrain,
  availability: AvailabilityResult
): FeasibleTrain {
  const calendar =
    getAvailabilityCalendar(
      availability
    );

  const availableSeats =
    findAvailableSeats(calendar);

  return {
    trainNumber:
      train.trainNumber,

    trainName:
      train.trainName,

    sourceStation:
      train.fromStation ??
      train.source ??
      "",

    sourceStationName:
      train.fromStationName ??
      train.sourceName,

    destinationStation:
      train.toStation ??
      train.destination ??
      "",

    destinationStationName:
      train.toStationName ??
      train.destinationName,

    departureTime:
      train.departureTime,

    arrivalTime:
      train.arrivalTime,

    travelTime:
      train.travelTime,

    availableSeats,

    status: "AVAILABLE",
  };
}

function findAvailableSeats(
  calendar: AvailabilityDay[]
): number | undefined {
  for (const day of calendar) {
    if (
      typeof day.availableSeats ===
      "number"
    ) {
      return day.availableSeats;
    }
  }

  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Date utilities                                                             */
/* -------------------------------------------------------------------------- */

function getDateRange(
  startDate: string,
  endDate: string
): string[] {
  const start =
    parseDate(startDate);

  const end =
    parseDate(endDate);

  if (
    !start ||
    !end ||
    start > end
  ) {
    return [];
  }

  const dates: string[] = [];

  const current =
    new Date(start);

  while (
    current <= end
  ) {
    dates.push(
      formatDate(current)
    );

    current.setDate(
      current.getDate() + 1
    );
  }

  return dates;
}

function addDays(
  date: string,
  days: number
): string {
  const parsed =
    parseDate(date);

  if (!parsed) {
    throw new Error(
      `Invalid date: ${date}`
    );
  }

  parsed.setDate(
    parsed.getDate() + days
  );

  return formatDate(parsed);
}

function parseDate(
  value: string
): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      value.trim()
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  if (
    date.getFullYear() !== year ||
    date.getMonth() !==
      month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function normalizeDate(
  value: string
): string {
  const trimmed =
    value.trim();

  /*
   * Already ISO.
   */
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      trimmed
    )
  ) {
    return trimmed;
  }

  /*
   * Common DD-MM-YYYY format.
   */
  const ddmmyyyy =
    /^(\d{2})-(\d{2})-(\d{4})$/.exec(
      trimmed
    );

  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }

  /*
   * ISO timestamp.
   */
  const isoDate =
    /^(\d{4})-(\d{2})-(\d{2})T/.exec(
      trimmed
    );

  if (isoDate) {
    return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  }

  return trimmed;
}

function formatDate(
  date: Date
): string {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* -------------------------------------------------------------------------- */
/* Sorting / normalization                                                    */
/* -------------------------------------------------------------------------- */

function uniqueCodes(
  stations: StationRef[]
): string[] {
  return [
    ...new Set(
      stations
        .map(
          (station) =>
            station.code
              .trim()
              .toUpperCase()
        )
        .filter(Boolean)
    ),
  ];
}

function compareDepartureTime(
  a: DiscoveredTrain,
  b: DiscoveredTrain
): number {
  return (
    timeToMinutes(
      a.departureTime
    ) -
    timeToMinutes(
      b.departureTime
    )
  );
}

function timeToMinutes(
  value?: string
): number {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  const match =
    /(\d{1,2}):(\d{2})/.exec(
      value
    );

  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  return (
    Number(match[1]) * 60 +
    Number(match[2])
  );
}

/* -------------------------------------------------------------------------- */
/* Error handling                                                             */
/* -------------------------------------------------------------------------- */

function isRateLimitError(
  error: unknown
): boolean {
  const message =
    getErrorMessage(error)
      .toLowerCase();

  return (
    message.includes(
      "rate limit"
    ) ||
    message.includes(
      "429"
    )
  );
}

function isProviderCoverageError(
  error: unknown
): boolean {
  const message =
    getErrorMessage(error)
      .toLowerCase();

  return (
    message.includes(
      "no valid profile"
    ) ||
    message.includes(
      "no valid station details"
    ) ||
    message.includes(
      "invalid station"
    ) ||
    message.includes(
      "station details found"
    ) ||
    message.includes(
      "not found"
    )
  );
}

function getErrorMessage(
  error: unknown
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  return String(error);
}

function validateInput(
  input: DateRangeFeasibilityInput
): void {
  if (
    !input.sourceStations?.length
  ) {
    throw new Error(
      "At least one source station is required."
    );
  }

  if (
    !input.destinationStations?.length
  ) {
    throw new Error(
      "At least one destination station is required."
    );
  }

  if (
    input.stayDays < 0 ||
    !Number.isInteger(
      input.stayDays
    )
  ) {
    throw new Error(
      "stayDays must be a non-negative integer."
    );
  }

  if (
    !input.classCode?.trim()
  ) {
    throw new Error(
      "classCode is required."
    );
  }

  if (
    !input.quotaCode?.trim()
  ) {
    throw new Error(
      "quotaCode is required."
    );
  }

  const start =
    parseDate(
      input.departureStartDate
    );

  const end =
    parseDate(
      input.departureEndDate
    );

  if (!start || !end) {
    throw new Error(
      "Departure dates must use YYYY-MM-DD format."
    );
  }

  if (start > end) {
    throw new Error(
      "Departure start date cannot be after the end date."
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

function sleep(
  milliseconds: number
): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}
import { getTrainsOnDates, type DiscoveredTrain } from "@/lib/ntes";
import { getTrainAvailability } from "@/lib/railradar";

export type StationRef = {
  code?: string;
  stationCode?: string;
  value?: string;
  name?: string;
  city?: string;
};

export type SearchMode = "KNOWN_DATE" | "FLEXIBLE_DATE";
export type TravelClassMode = "ANY" | string;
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type DateCheckStatus = "checking" | "available" | "unavailable";

export type DateRangeFeasibilityInput = {
  sourceStations: StationRef[];
  destinationStations: StationRef[];
  departureDate: string;
  expectedReturnDate?: string;
  classCode: TravelClassMode;
  quotaCode?: string;
  mode?: SearchMode;
};

export type AvailableTrainOption = {
  trainNumber: string;
  trainName?: string;
  fromStation: string;
  toStation: string;
  fromStationName?: string;
  toStationName?: string;
  departureTime?: string;
  arrivalTime?: string;
  travelTime?: string;
  trainType?: string;
  classCode: string;
  quotaCode: string;
  status: string;
  availableSeats?: number;
  journeyDate: string;
  durationMinutes?: number;
  score: number;
};

export type DateFeasibility = {
  departureDate: string;
  status: DateCheckStatus;
  available: boolean;
  outboundOptions: AvailableTrainOption[];
  returnWindowStart?: string;
  returnWindowEnd?: string;
  availableReturnDates: string[];
  returnOptionsByDate: Record<string, AvailableTrainOption[]>;
};

export type DateRangeFeasibilityResult = {
  departureStartDate: string;
  departureEndDate: string;
  expectedReturnDate?: string;
  mode: SearchMode;
  dates: DateFeasibility[];
  totalDates: number;
  feasibleDates: number;
  searchedClasses: string[];
  providerWarnings: string[];
};

export type FeasibilityJob = {
  id: string;
  status: JobStatus;
  progress: number;
  error?: string;
  data: DateRangeFeasibilityResult;
};

type Candidate = {
  train: DiscoveredTrain;
  source: string;
  destination: string;
  classes: string[];
  operatingDates: Set<string>;
};

type CachedAvailability = Awaited<ReturnType<typeof getTrainAvailability>>;

const PROVIDER_WINDOW_DAYS = 14;
const SEARCH_HORIZON_DAYS = 60;
const CACHE_TTL_MS = 60_000;
// RailRadar allows at most 10 requests per minute. We therefore use a
// shared rolling-window limiter instead of the old one-request-every-6-seconds
// queue. A small burst is safe and makes a search dramatically faster while
// still respecting the provider limit.
const PROVIDER_MAX_REQUESTS_PER_MINUTE = 10;
const PROVIDER_WINDOW_MS = 60_000;
const PROVIDER_CONCURRENCY = 8;
const MAX_FLEXIBLE_LIVE_CANDIDATES = 2;
const MAX_KNOWN_LIVE_CANDIDATES = 8;
const MAX_OPTIONS_PER_DATE = 100;
const MAX_ANY_CLASSES = 2;

const ANY_CLASS_PRIORITY = ["3A", "SL", "2A", "3E", "1A"];

const availabilityCache = new Map<
  string,
  { expiresAt: number; value: CachedAvailability }
>();

const providerRequestTimestamps: number[] = [];
let providerLimiter: Promise<void> = Promise.resolve();

const jobs = new Map<string, FeasibilityJob>();

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

function addDays(value: string, amount: number): string {
  const d = parseDate(value);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function dayDifference(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

function range(start: string, end: string): string[] {
  const count = dayDifference(start, end) + 1;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

function normalizeStationCode(station: StationRef): string {
  const values = [station.code, station.stationCode, station.value];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toUpperCase();
    if (normalized) return normalized;
  }
  return "";
}

function uniqueCodes(stations: StationRef[]): string[] {
  return [...new Set(stations.map(normalizeStationCode).filter(Boolean))];
}

function parseClasses(value?: string): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[,\s/|;]+/).map(x => x.trim().toUpperCase()).filter(Boolean))];
}

function supportsClass(train: DiscoveredTrain, requested: string): boolean {
  return requested === "ANY" || parseClasses(train.classes).includes(requested);
}

function classesForCandidate(candidate: Candidate, requested: string): string[] {
  if (requested !== "ANY") return [requested];
  const reported = parseClasses(candidate.train.classes);
  const prioritized = ANY_CLASS_PRIORITY.filter(x => reported.includes(x));
  const remainder = reported.filter(x => !prioritized.includes(x));
  return [...prioritized, ...remainder].slice(0, MAX_ANY_CLASSES);
}

function durationMinutes(value?: string): number | undefined {
  if (!value) return undefined;
  const h = value.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)/i);
  const m = value.match(/(\d+)\s*(?:m|min|mins|minute|minutes)/i);
  if (!h && !m) return undefined;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

function optionScore(option: Pick<AvailableTrainOption, "durationMinutes" | "availableSeats" | "departureTime">): number {
  let value = option.durationMinutes ?? 1500;
  if (option.availableSeats !== undefined) value += Math.max(0, 10 - option.availableSeats) * 1.5;
  const hour = option.departureTime?.match(/^(\d{1,2}):/);
  if (hour && Number(hour[1]) < 5) value += 30;
  return value;
}

function rank(options: AvailableTrainOption[]): AvailableTrainOption[] {
  return [...options].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return (b.availableSeats ?? -1) - (a.availableSeats ?? -1);
  });
}

function makeOption(
  train: DiscoveredTrain,
  day: { status: string; availableSeats?: number },
  classCode: string,
  quotaCode: string,
  journeyDate: string,
): AvailableTrainOption {
  const duration = durationMinutes(train.travelTime);
  return {
    trainNumber: train.trainNumber,
    trainName: train.trainName,
    fromStation: train.fromStation ?? "",
    toStation: train.toStation ?? "",
    fromStationName: train.fromStationName,
    toStationName: train.toStationName,
    departureTime: train.departureTime,
    arrivalTime: train.arrivalTime,
    travelTime: train.travelTime,
    trainType: train.trainType,
    classCode,
    quotaCode,
    status: day.status,
    availableSeats: day.availableSeats,
    journeyDate,
    durationMinutes: duration,
    score: optionScore({ durationMinutes: duration, availableSeats: day.availableSeats, departureTime: train.departureTime }),
  };
}

async function providerSlot(): Promise<void> {
  // Serialize only the tiny limiter bookkeeping section. The actual HTTP
  // requests are allowed to run concurrently.
  let release!: () => void;
  const previous = providerLimiter;
  providerLimiter = new Promise(resolve => { release = resolve; });
  await previous;

  try {
    while (true) {
      const now = Date.now();
      while (providerRequestTimestamps.length && now - providerRequestTimestamps[0] >= PROVIDER_WINDOW_MS) {
        providerRequestTimestamps.shift();
      }

      if (providerRequestTimestamps.length < PROVIDER_MAX_REQUESTS_PER_MINUTE) {
        providerRequestTimestamps.push(now);
        return;
      }

      const wait = Math.max(250, PROVIDER_WINDOW_MS - (now - providerRequestTimestamps[0]) + 50);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  } finally {
    release();
  }
}

async function availability(params: {
  trainNumber: string;
  source: string;
  destination: string;
  journeyDate: string;
  classCode: string;
  quotaCode: string;
}): Promise<CachedAvailability> {
  const key = [params.trainNumber, params.source, params.destination, params.journeyDate, params.classCode, params.quotaCode]
    .map(x => String(x).toUpperCase()).join("|");
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) availabilityCache.delete(key);

  await providerSlot();
  const value = await getTrainAvailability(params);
  availabilityCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

function candidateKey(train: DiscoveredTrain): string {
  return [train.trainNumber, train.fromStation ?? "", train.toStation ?? ""]
    .map(x => String(x).toUpperCase()).join("|");
}

function candidatePriority(candidate: Candidate, totalDates: number, requestedClass: string): number {
  const duration = durationMinutes(candidate.train.travelTime) ?? 1500;
  const coverage = candidate.operatingDates.size / Math.max(1, totalDates);
  const classBonus = requestedClass !== "ANY" && candidate.classes.includes(requestedClass) ? 100 : 0;
  return duration - coverage * 700 - candidate.classes.length * 10 - classBonus;
}

async function discover(
  sources: string[],
  destinations: string[],
  dates: string[],
  requestedClass: string,
  maxCandidates: number,
): Promise<Candidate[]> {
  if (!dates.length) return [];
  const timetable = await getTrainsOnDates({ sources, destinations, dates });
  const map = new Map<string, Candidate>();
  const dateSet = new Set(dates);

  for (const d of dates) {
    for (const train of timetable.dates[d] ?? []) {
      if (!supportsClass(train, requestedClass)) continue;
      const source = (train.fromStation ?? "").trim().toUpperCase();
      const destination = (train.toStation ?? "").trim().toUpperCase();
      if (!source || !destination || source === destination) continue;

      const key = candidateKey(train);
      const existing = map.get(key);
      if (existing) {
        existing.operatingDates.add(d);
        for (const cls of parseClasses(train.classes)) {
          if (!existing.classes.includes(cls)) existing.classes.push(cls);
        }
        continue;
      }

      map.set(key, {
        train,
        source,
        destination,
        classes: parseClasses(train.classes),
        operatingDates: new Set([d]),
      });
    }
  }

  const sorted = [...map.values()]
    .map(candidate => ({
      ...candidate,
      operatingDates: new Set([...candidate.operatingDates].filter(d => dateSet.has(d))),
    }))
    .sort((a, b) => candidatePriority(a, dates.length, requestedClass) - candidatePriority(b, dates.length, requestedClass));

  // Preserve station-pair diversity. A city can resolve to several stations,
  // so never spend the entire live-check budget on one station pair.
  const groups = new Map<string, Candidate[]>();
  for (const candidate of sorted) {
    const key = `${candidate.source}|${candidate.destination}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const selected: Candidate[] = [];
  const groupLists = [...groups.values()];
  let index = 0;
  while (selected.length < Math.max(0, maxCandidates) && groupLists.length) {
    let added = false;
    for (const group of groupLists) {
      if (index < group.length && selected.length < maxCandidates) {
        selected.push(group[index]);
        added = true;
      }
    }
    if (!added) break;
    index++;
  }

  return selected;
}

function providerAnchors(start: string, end: string): string[] {
  const dates = range(start, end);
  const anchors: string[] = [];
  for (let i = 0; i < dates.length; i += PROVIDER_WINDOW_DAYS) anchors.push(dates[i]);
  return anchors;
}

function dedupe(options: AvailableTrainOption[]): AvailableTrainOption[] {
  const map = new Map<string, AvailableTrainOption>();
  for (const option of options) {
    const key = [option.trainNumber, option.fromStation, option.toStation, option.journeyDate, option.classCode, option.quotaCode].join("|");
    const current = map.get(key);
    if (!current || option.score < current.score) map.set(key, option);
  }
  return [...map.values()];
}

function returnWindow(departureDate: string, expectedReturnDate?: string): { start: string; end: string } | null {
  if (!expectedReturnDate) return null;
  const start = addDays(expectedReturnDate, -6);
  const legalStart = addDays(departureDate, 1);
  const actualStart = start < legalStart ? legalStart : start;
  const end = addDays(expectedReturnDate, 6);
  return actualStart <= end ? { start: actualStart, end } : null;
}

function flexibleReturnEnd(departureDate: string): string {
  return addDays(departureDate, SEARCH_HORIZON_DAYS - 1);
}

function emptyDate(departureDate: string, window?: { start: string; end: string }): DateFeasibility {
  return {
    departureDate,
    status: "checking",
    available: false,
    outboundOptions: [],
    returnWindowStart: window?.start,
    returnWindowEnd: window?.end,
    availableReturnDates: [],
    returnOptionsByDate: {},
  };
}

function recomputeDate(dateResult: DateFeasibility): void {
  dateResult.outboundOptions = rank(dedupe(dateResult.outboundOptions)).slice(0, MAX_OPTIONS_PER_DATE);
  const availableReturnDates = Object.keys(dateResult.returnOptionsByDate)
    .filter(date => date > dateResult.departureDate)
    .sort();
  dateResult.availableReturnDates = availableReturnDates;
  dateResult.available = dateResult.outboundOptions.length > 0 && availableReturnDates.length > 0;
  dateResult.status = dateResult.available ? "available" : "unavailable";
}

function initialResult(input: DateRangeFeasibilityInput, mode: SearchMode): DateRangeFeasibilityResult {
  const departureDates = mode === "KNOWN_DATE"
    ? [input.departureDate]
    : range(input.departureDate, addDays(input.departureDate, SEARCH_HORIZON_DAYS - 1));

  return {
    departureStartDate: departureDates[0],
    departureEndDate: departureDates[departureDates.length - 1],
    expectedReturnDate: input.expectedReturnDate,
    mode,
    dates: departureDates.map(departureDate => emptyDate(departureDate, returnWindow(departureDate, input.expectedReturnDate) ?? undefined)),
    totalDates: departureDates.length,
    feasibleDates: 0,
    searchedClasses: [],
    providerWarnings: [
      "Calendar dates are marked available only after confirmed live availability is found for both directions.",
      "City selections are evaluated as station groups and outbound and return station pairs are discovered independently.",
    ],
  };
}

function refreshCounts(result: DateRangeFeasibilityResult): void {
  result.feasibleDates = result.dates.filter(x => x.available).length;
}

function getDateResult(result: DateRangeFeasibilityResult, dateValue: string): DateFeasibility | undefined {
  return result.dates.find(x => x.departureDate === dateValue);
}

async function evaluateOutbound(
  job: FeasibilityJob,
  candidates: Candidate[],
  dates: string[],
  requestedClass: string,
  quotaCode: string,
): Promise<void> {
  const anchors = providerAnchors(dates[0], dates[dates.length - 1]);
  const dateSet = new Set(dates);

  const tasks: Array<{ candidate: Candidate; classCode: string; anchor: string }> = [];
  for (const candidate of candidates) {
    for (const classCode of classesForCandidate(candidate, requestedClass)) {
      for (const anchor of anchors) {
        const windowDates = range(anchor, addDays(anchor, PROVIDER_WINDOW_DAYS - 1)).filter(d => dateSet.has(d));
        if (windowDates.some(d => candidate.operatingDates.has(d))) {
          tasks.push({ candidate, classCode, anchor });
        }
      }
    }
  }

  let completed = 0;
  const total = Math.max(1, tasks.length);

  async function worker(): Promise<void> {
    while (true) {
      const index = completed;
      if (index >= tasks.length) return;
      completed++;
      const task = tasks[index];

      try {
        const response = await availability({
          trainNumber: task.candidate.train.trainNumber,
          source: task.candidate.source,
          destination: task.candidate.destination,
          journeyDate: task.anchor,
          classCode: task.classCode,
          quotaCode,
        });

        for (const day of response.calendar) {
          if (!day.isAvailable || day.statusCode !== "AVAILABLE" || !dateSet.has(day.date)) continue;
          if (!task.candidate.operatingDates.has(day.date)) continue;
          const dateResult = getDateResult(job.data, day.date);
          if (!dateResult) continue;
          dateResult.outboundOptions.push(makeOption(task.candidate.train, day, task.classCode, quotaCode, day.date));
          recomputeDate(dateResult);
        }
      } catch (error) {
        console.warn(`Outbound availability failed for ${task.candidate.train.trainNumber} ${task.candidate.source} → ${task.candidate.destination}:`, error instanceof Error ? error.message : error);
      }

      job.progress = Math.min(99, Math.round((completed / total) * 100));
      refreshCounts(job.data);
    }
  }

  await Promise.all(Array.from({ length: Math.min(PROVIDER_CONCURRENCY, Math.max(1, tasks.length)) }, () => worker()));
}

async function evaluateReturns(
  job: FeasibilityJob,
  candidates: Candidate[],
  returnStart: string,
  returnEnd: string,
  requestedClass: string,
  quotaCode: string,
): Promise<void> {
  const dates = range(returnStart, returnEnd);
  const dateSet = new Set(dates);
  const anchors = providerAnchors(returnStart, returnEnd);

  const tasks: Array<{ candidate: Candidate; classCode: string; anchor: string }> = [];
  for (const candidate of candidates) {
    for (const classCode of classesForCandidate(candidate, requestedClass)) {
      for (const anchor of anchors) {
        const windowDates = range(anchor, addDays(anchor, PROVIDER_WINDOW_DAYS - 1)).filter(d => dateSet.has(d));
        if (windowDates.some(d => candidate.operatingDates.has(d))) {
          tasks.push({ candidate, classCode, anchor });
        }
      }
    }
  }

  let nextTask = 0;
  const total = Math.max(1, tasks.length);
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextTask++;
      if (index >= tasks.length) return;
      const task = tasks[index];

      try {
        const response = await availability({
          trainNumber: task.candidate.train.trainNumber,
          source: task.candidate.source,
          destination: task.candidate.destination,
          journeyDate: task.anchor,
          classCode: task.classCode,
          quotaCode,
        });

        for (const day of response.calendar) {
          if (!day.isAvailable || day.statusCode !== "AVAILABLE" || !dateSet.has(day.date)) continue;
          if (!task.candidate.operatingDates.has(day.date)) continue;

          const option = makeOption(task.candidate.train, day, task.classCode, quotaCode, day.date);
          for (const dateResult of job.data.dates) {
            if (dayDifference(dateResult.departureDate, day.date) < 1) continue;
            if (!dateResult.returnWindowStart || !dateResult.returnWindowEnd) continue;
            if (day.date < dateResult.returnWindowStart || day.date > dateResult.returnWindowEnd) continue;
            const list = dateResult.returnOptionsByDate[day.date] ?? [];
            dateResult.returnOptionsByDate[day.date] = rank(dedupe([...list, option])).slice(0, MAX_OPTIONS_PER_DATE);
            recomputeDate(dateResult);
          }
        }
      } catch (error) {
        console.warn(`Return availability failed for ${task.candidate.train.trainNumber} ${task.candidate.source} → ${task.candidate.destination}:`, error instanceof Error ? error.message : error);
      }

      completed++;
      job.progress = Math.min(99, Math.round((completed / total) * 100));
      refreshCounts(job.data);
    }
  }

  await Promise.all(Array.from({ length: Math.min(PROVIDER_CONCURRENCY, Math.max(1, tasks.length)) }, () => worker()));
}

async function runSearch(job: FeasibilityJob, input: DateRangeFeasibilityInput): Promise<void> {
  const mode: SearchMode = input.mode ?? "FLEXIBLE_DATE";
  const requestedClass = input.classCode.trim().toUpperCase();
  const quotaCode = (input.quotaCode ?? "GN").trim().toUpperCase();
  const sources = uniqueCodes(input.sourceStations);
  const destinations = uniqueCodes(input.destinationStations);

  if (!sources.length || !destinations.length) throw new Error("At least one source and destination station is required.");
  if (!requestedClass) throw new Error("Travel class is required.");
  if (input.expectedReturnDate && dayDifference(input.departureDate, input.expectedReturnDate) < 1) {
    throw new Error("Expected return must be after the departure date.");
  }

  job.status = "running";
  job.data.searchedClasses = requestedClass === "ANY" ? ANY_CLASS_PRIORITY.slice(0, MAX_ANY_CLASSES) : [requestedClass];

  const departureDates = job.data.dates.map(x => x.departureDate);
  const returnStart = input.expectedReturnDate
    ? addDays(input.expectedReturnDate, -6)
    : addDays(input.departureDate, 1);
  const returnEnd = input.expectedReturnDate
    ? addDays(input.expectedReturnDate, 6)
    : flexibleReturnEnd(input.departureDate);

  // Discover both directions concurrently. This stage is local timetable work.
  const liveCandidateLimit = mode === "KNOWN_DATE"
    ? MAX_KNOWN_LIVE_CANDIDATES
    : MAX_FLEXIBLE_LIVE_CANDIDATES;

  const [outboundCandidates, returnCandidates] = await Promise.all([
    discover(sources, destinations, departureDates, requestedClass, liveCandidateLimit),
    discover(destinations, sources, range(returnStart, returnEnd), requestedClass, liveCandidateLimit),
  ]);

  console.log(`Selected outbound live candidates: ${outboundCandidates.length}`);
  console.log(`Selected return live candidates: ${returnCandidates.length}`);

  // Live checks are intentionally staged. The browser receives the job immediately
  // and polls while these rate-limited provider windows are processed.
  await evaluateOutbound(job, outboundCandidates, departureDates, requestedClass, quotaCode);

  for (const dateResult of job.data.dates) {
    const window = returnWindow(dateResult.departureDate, input.expectedReturnDate);
    if (window) {
      dateResult.returnWindowStart = window.start;
      dateResult.returnWindowEnd = window.end;
    } else if (!input.expectedReturnDate) {
      dateResult.returnWindowStart = addDays(dateResult.departureDate, 1);
      dateResult.returnWindowEnd = flexibleReturnEnd(dateResult.departureDate);
    }
  }

  await evaluateReturns(job, returnCandidates, returnStart, returnEnd, requestedClass, quotaCode);

  for (const dateResult of job.data.dates) recomputeDate(dateResult);
  refreshCounts(job.data);
  job.progress = 100;
  job.status = "completed";
}

export function startFeasibilitySearch(input: DateRangeFeasibilityInput): FeasibilityJob {
  const mode = input.mode ?? "FLEXIBLE_DATE";
  const data = initialResult(input, mode);
  const job: FeasibilityJob = {
    id: crypto.randomUUID(),
    status: "queued",
    progress: 0,
    data,
  };
  jobs.set(job.id, job);

  void runSearch(job, input).catch(error => {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Unable to complete the search.";
  });

  return job;
}

export function getFeasibilityJob(id: string): FeasibilityJob | undefined {
  return jobs.get(id);
}

export async function checkDateRangeFeasibility(input: DateRangeFeasibilityInput): Promise<DateRangeFeasibilityResult> {
  const job = startFeasibilitySearch(input);
  while (job.status === "queued" || job.status === "running") {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (job.status === "failed") throw new Error(job.error ?? "Unable to complete the search.");
  return job.data;
}

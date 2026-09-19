"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Station = {
  code: string;
  name: string;
  city?: string;
  state?: string;
};

type StationSelection = {
  type: "station" | "city";
  station: Station;
  stations: string[];
  label: string;
};

type SearchMode = "KNOWN_DATE" | "FLEXIBLE_DATE";

type TrainOption = {
  trainNumber?: string;
  trainName?: string;
  fromStation?: string;
  toStation?: string;
  fromStationName?: string;
  toStationName?: string;
  fromCode?: string;
  toCode?: string;
  fromName?: string;
  toName?: string;
  departureTime?: string;
  arrivalTime?: string;
  travelTime?: string;
  classCode?: string;
  quotaCode?: string;
  status?: string;
  availability?: string;
  availableSeats?: number;
  seats?: number;
  available?: boolean;
  journeyDate?: string;
};

type DateResult = {
  departureDate: string;
  feasible?: boolean;
  available?: boolean;
  status?: "checking" | "available" | "unavailable";
  outboundOptions: TrainOption[];
  returnWindowStart?: string;
  returnWindowEnd?: string;
  availableReturnDates?: string[];
  returnOptionsByDate?: Record<string, TrainOption[]>;
};

type FeasibilityResponse = {
  success: boolean;
  jobId?: string;
  status?: "queued" | "running" | "completed" | "failed";
  progress?: number;
  data?: {
    searchMode?: SearchMode;
    dates?: DateResult[];
    expectedReturnDate?: string;
    departureStartDate?: string;
    departureEndDate?: string;
  };
  error?: string;
};

const CLASS_OPTIONS = [
  { value: "ANY", label: "Any class" },
  { value: "1A", label: "AC First Class (1A)" },
  { value: "2A", label: "AC 2 Tier (2A)" },
  { value: "3A", label: "AC 3 Tier (3A)" },
  { value: "3E", label: "AC 3 Economy (3E)" },
  { value: "SL", label: "Sleeper (SL)" },
  { value: "CC", label: "AC Chair Car (CC)" },
  { value: "EC", label: "Executive Chair Car (EC)" },
  { value: "2S", label: "Second Sitting (2S)" },
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeDate(value: unknown): string {
  if (typeof value !== "string") return "";

  const raw = value.trim();
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.getFullYear() === Number(y) &&
      date.getMonth() === Number(m) - 1 &&
      date.getDate() === Number(d)
      ? `${y}-${m}-${d}`
      : "";
  }

  const indian = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (indian) {
    const [, d, m, y] = indian;
    const day = Number(d);
    const month = Number(m);
    const year = Number(y);
    const date = new Date(year, month - 1, day);

    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? `${year}-${pad(month)}-${pad(day)}`
      : "";
  }

  const timestamp = Date.parse(raw);
  if (!Number.isNaN(timestamp)) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  return "";
}

function dateObject(value: string): Date | null {
  const normalized = normalizeDate(value);
  if (!normalized) return null;

  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

function addDays(value: string, amount: number): string {
  const date = dateObject(value);
  if (!date) return "";

  date.setDate(date.getDate() + amount);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function compareDates(a: string, b: string) {
  const da = dateObject(a);
  const db = dateObject(b);
  if (!da || !db) return 0;
  return da.getTime() - db.getTime();
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = dateObject(value);
  if (!date) return "—";

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatShortDate(value?: string) {
  if (!value) return "";
  const date = dateObject(value);
  if (!date) return "";

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function monthLabel(value: string) {
  const date = dateObject(value);
  if (!date) return "";

  return date.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function dayName(value: string) {
  const date = dateObject(value);
  if (!date) return "";

  return date.toLocaleDateString("en-IN", {
    weekday: "short",
  });
}

function getToday() {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function generateDateRange(start: string, count: number) {
  const normalized = normalizeDate(start);
  if (!normalized) return [];

  return Array.from({ length: count }, (_, index) =>
    addDays(normalized, index),
  ).filter(Boolean);
}

function TrainCard({ train }: { train: TrainOption }) {
  const fromCode = train.fromStation || train.fromCode;
  const toCode = train.toStation || train.toCode;
  const fromName = train.fromStationName || train.fromName;
  const toName = train.toStationName || train.toName;

  const availability =
    train.availability ||
    train.status ||
    (typeof train.availableSeats === "number"
      ? `${train.availableSeats} seats`
      : typeof train.seats === "number"
        ? `${train.seats} seats`
        : "Confirmed");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h5 className="font-semibold">
            {train.trainNumber && train.trainName
              ? `${train.trainNumber} • ${train.trainName}`
              : train.trainName || train.trainNumber || "Train"}
          </h5>

          {(fromCode || toCode) && (
            <p className="mt-1 text-xs text-slate-500">
              {fromCode || ""}
              {fromCode && toCode ? " → " : ""}
              {toCode || ""}
            </p>
          )}
        </div>

        <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
          {availability}
        </span>
      </div>

      {(fromName || toName) && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {fromName || fromCode || "Origin"} → {toName || toCode || "Destination"}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-slate-500">Departure</p>
          <p className="mt-1 font-medium">{train.departureTime || "—"}</p>
        </div>

        <div>
          <p className="text-xs text-slate-500">Arrival</p>
          <p className="mt-1 font-medium">{train.arrivalTime || "—"}</p>
        </div>

        {train.travelTime && (
          <div>
            <p className="text-xs text-slate-500">Journey</p>
            <p className="mt-1 font-medium">{train.travelTime}</p>
          </div>
        )}

        {train.classCode && (
          <div>
            <p className="text-xs text-slate-500">Class</p>
            <p className="mt-1 font-medium">{train.classCode}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LocationPicker({
  label,
  value,
  suggestions,
  selection,
  loading,
  onChange,
  onSelectStation,
  onSelectCity,
}: {
  label: string;
  value: string;
  suggestions: Station[];
  selection: StationSelection | null;
  loading: boolean;
  onChange: (value: string) => void;
  onSelectStation: (station: Station) => void;
  onSelectCity: (city: string, stations: Station[]) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, Station[]>();

    for (const station of suggestions) {
      const city =
        station.city?.trim() ||
        station.name.trim();

      const list = map.get(city) || [];
      list.push(station);
      map.set(city, list);
    }

    return [...map.entries()];
  }, [suggestions]);

  return (
    <div className="relative">
      <label className="mb-2 block text-sm font-medium">
        {label}
      </label>

      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search station or city"
        autoComplete="off"
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />

      {selection && (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {selection.type === "city" ? (
            <>
              Considering{" "}
              <strong className="text-slate-900">
                {selection.stations.length} stations
              </strong>{" "}
              in {selection.station.city || selection.station.name}.
            </>
          ) : (
            <>
              Selected station:{" "}
              <strong className="text-slate-900">
                {selection.label}
              </strong>
            </>
          )}
        </div>
      )}

      {!selection && suggestions.length > 0 && (
        <div className="absolute z-30 mt-2 max-h-96 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl">
          {groups.map(([city, stations]) => {
            const uniqueStations = [
              ...new Map(
                stations.map((station) => [
                  station.code,
                  station,
                ]),
              ).values(),
            ];

            return (
              <div key={city}>
                {uniqueStations.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onSelectCity(city, uniqueStations)
                    }
                    className="w-full border-b border-slate-100 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
                  >
                    <div className="font-semibold text-slate-900">
                      {city}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Use all {uniqueStations.length} relevant stations
                    </div>
                  </button>
                )}

                {uniqueStations.map((station) => (
                  <button
                    key={`${city}-${station.code}`}
                    type="button"
                    onClick={() => onSelectStation(station)}
                    className="block w-full border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">
                          {station.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {station.city || city}
                          {station.state
                            ? `, ${station.state}`
                            : ""}
                        </div>
                      </div>

                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                        {station.code}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="mt-2 text-sm text-slate-500">
          Searching stations…
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [searchMode, setSearchMode] =
    useState<SearchMode>("KNOWN_DATE");

  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");

  const [fromSuggestions, setFromSuggestions] =
    useState<Station[]>([]);
  const [toSuggestions, setToSuggestions] =
    useState<Station[]>([]);

  const [fromSelection, setFromSelection] =
    useState<StationSelection | null>(null);
  const [toSelection, setToSelection] =
    useState<StationSelection | null>(null);

  const [departureDate, setDepartureDate] = useState(
    getToday(),
  );
  const [expectedReturnDate, setExpectedReturnDate] =
    useState("");

  const [classCode, setClassCode] =
    useState("3A");
  const [quotaCode, setQuotaCode] =
    useState("GN");

  const [results, setResults] =
    useState<DateResult[]>([]);

  const [searchedTrip, setSearchedTrip] =
    useState<{
      searchMode: SearchMode;
      from: StationSelection;
      to: StationSelection;
      departureDate: string;
      expectedReturnDate?: string;
      classCode: string;
      quotaCode: string;
    } | null>(null);

  const [selectedDepartureDate, setSelectedDepartureDate] =
    useState("");

  const [selectedReturnDate, setSelectedReturnDate] =
    useState("");

  const [calendarMonthIndex, setCalendarMonthIndex] =
    useState(0);

  const [loadingStations, setLoadingStations] =
    useState<"FROM" | "TO" | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [detailLoadingDate, setDetailLoadingDate] = useState("");
  const searchSequence = useRef(0);
  const detailSequence = useRef(0);
  const detailedDates = useRef(new Set<string>());

  useEffect(() => {
    const query = fromQuery.trim();

    if (!query || fromSelection) {
      setFromSuggestions([]);
      return;
    }

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      setLoadingStations("FROM");

      try {
        const response = await fetch(
          `/api/stations?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );

        const payload = await response.json();

        const stations = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.stations)
              ? payload.stations
              : [];

        setFromSuggestions(stations.slice(0, 20));
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setFromSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingStations(null);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [fromQuery, fromSelection]);

  useEffect(() => {
    const query = toQuery.trim();

    if (!query || toSelection) {
      setToSuggestions([]);
      return;
    }

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      setLoadingStations("TO");

      try {
        const response = await fetch(
          `/api/stations?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );

        const payload = await response.json();

        const stations = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.stations)
              ? payload.stations
              : [];

        setToSuggestions(stations.slice(0, 20));
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setToSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingStations(null);
        }
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [toQuery, toSelection]);

  async function expandNearbyStations(station: Station): Promise<Station[]> {
    const city = station.city?.trim();
    if (!city) return [station];

    try {
      const response = await fetch(`/api/stations?q=${encodeURIComponent(city)}`, { cache: "no-store" });
      if (!response.ok) return [station];
      const payload = await response.json();
      const stations = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.stations)
            ? payload.stations
            : [];

      const unique = [
        ...new Map(
          [...stations, station].map((item: Station) => [item.code, item]),
        ).values(),
      ];

      return unique.length ? unique : [station];
    } catch {
      return [station];
    }
  }

  async function selectFromStation(station: Station) {
    const nearby = await expandNearbyStations(station);
    setFromSelection({
      type: nearby.length > 1 ? "city" : "station",
      station,
      stations: nearby.map((item) => item.code),
      label: nearby.length > 1
        ? `${station.city || station.name} — ${nearby.length} nearby stations`
        : `${station.name} (${station.code})`,
    });
    setFromQuery(nearby.length > 1 ? (station.city || station.name) : `${station.name} (${station.code})`);
    setFromSuggestions([]);
  }

  async function selectToStation(station: Station) {
    const nearby = await expandNearbyStations(station);
    setToSelection({
      type: nearby.length > 1 ? "city" : "station",
      station,
      stations: nearby.map((item) => item.code),
      label: nearby.length > 1
        ? `${station.city || station.name} — ${nearby.length} nearby stations`
        : `${station.name} (${station.code})`,
    });
    setToQuery(nearby.length > 1 ? (station.city || station.name) : `${station.name} (${station.code})`);
    setToSuggestions([]);
  }

  function selectFromCity(city: string, stations: Station[]) {
    const unique = [
      ...new Map(
        stations.map((station) => [
          station.code,
          station,
        ]),
      ).values(),
    ];

    setFromSelection({
      type: "city",
      station: unique[0],
      stations: unique.map((station) => station.code),
      label: `${city} — Multiple stations`,
    });
    setFromQuery(city);
    setFromSuggestions([]);
  }

  function selectToCity(city: string, stations: Station[]) {
    const unique = [
      ...new Map(
        stations.map((station) => [
          station.code,
          station,
        ]),
      ).values(),
    ];

    setToSelection({
      type: "city",
      station: unique[0],
      stations: unique.map((station) => station.code),
      label: `${city} — Multiple stations`,
    });
    setToQuery(city);
    setToSuggestions([]);
  }

  function changeFromQuery(value: string) {
    setFromQuery(value);
    setFromSelection(null);
  }

  function changeToQuery(value: string) {
    setToQuery(value);
    setToSelection(null);
  }

  const calendarDates = useMemo(() => {
    if (!searchedTrip || searchedTrip.searchMode !== "FLEXIBLE_DATE") {
      return [];
    }

    return generateDateRange(
      searchedTrip.departureDate,
      60,
    );
  }, [searchedTrip]);

  const calendarMonths = useMemo(() => {
    const groups: string[][] = [];

    for (const date of calendarDates) {
      const label = monthLabel(date);
      const group = groups.find(
        (item) => monthLabel(item[0]) === label,
      );

      if (group) group.push(date);
      else groups.push([date]);
    }

    return groups;
  }, [calendarDates]);

  const visibleMonthDates =
    calendarMonths[calendarMonthIndex] || [];

  const selectedResult = useMemo(() => {
    if (!selectedDepartureDate) return null;

    return (
      results.find(
        (result) =>
          normalizeDate(result.departureDate) ===
          normalizeDate(selectedDepartureDate),
      ) || null
    );
  }, [results, selectedDepartureDate]);

  const availableReturnDates = useMemo(() => {
    if (!selectedResult) return [];

    return [
      ...(selectedResult.availableReturnDates || []),
    ]
      .map(normalizeDate)
      .filter(Boolean)
      .sort(compareDates);
  }, [selectedResult]);

  const selectedReturnOptions = useMemo(() => {
    if (!selectedResult || !selectedReturnDate) {
      return [];
    }

    return (
      selectedResult.returnOptionsByDate?.[
        selectedReturnDate
      ] || []
    );
  }, [selectedResult, selectedReturnDate]);

  const calculatedReturnWindow = useMemo(() => {
    if (!searchedTrip || !selectedDepartureDate) {
      return null;
    }

    const expected = searchedTrip.expectedReturnDate;

    if (!expected) {
      const start =
        normalizeDate(
          selectedResult?.returnWindowStart || "",
        ) || addDays(selectedDepartureDate, 1);

      const end =
        normalizeDate(
          selectedResult?.returnWindowEnd || "",
        ) || addDays(selectedDepartureDate, 59);

      return { start, end };
    }

    const startCandidate = addDays(expected, -6);
    const legalMinimum = addDays(
      selectedDepartureDate,
      1,
    );

    const start =
      compareDates(
        startCandidate,
        legalMinimum,
      ) < 0
        ? legalMinimum
        : startCandidate;

    const end = addDays(expected, 6);

    if (compareDates(start, end) > 0) {
      return null;
    }

    return { start, end };
  }, [
    searchedTrip,
    selectedDepartureDate,
    selectedResult,
  ]);

  const visibleAvailableReturnDates = useMemo(() => {
    if (!selectedResult) return [];

    const dates = availableReturnDates;

    if (!calculatedReturnWindow) {
      return dates;
    }

    return dates.filter(
      (date) =>
        compareDates(
          date,
          calculatedReturnWindow.start,
        ) >= 0 &&
        compareDates(
          date,
          calculatedReturnWindow.end,
        ) <= 0,
    );
  }, [
    selectedResult,
    availableReturnDates,
    calculatedReturnWindow,
  ]);

  useEffect(() => {
    if (!selectedResult) {
      setSelectedReturnDate("");
      return;
    }

    if (
      selectedReturnDate &&
      visibleAvailableReturnDates.includes(
        selectedReturnDate,
      )
    ) {
      return;
    }

    const expected =
      searchedTrip?.expectedReturnDate;

    if (
      expected &&
      visibleAvailableReturnDates.includes(expected)
    ) {
      setSelectedReturnDate(expected);
      return;
    }

    setSelectedReturnDate(
      visibleAvailableReturnDates[0] || "",
    );
  }, [
    selectedResult,
    selectedReturnDate,
    visibleAvailableReturnDates,
    searchedTrip,
  ]);

  async function handleSearch(
    event?: React.FormEvent,
  ) {
    event?.preventDefault();

    setError("");

    if (!fromSelection) {
      setError("Please select a valid From city or station.");
      return;
    }

    if (!toSelection) {
      setError("Please select a valid To city or station.");
      return;
    }

    const normalizedDeparture = normalizeDate(departureDate);
    if (!normalizedDeparture) {
      setError("Select a valid departure date.");
      return;
    }

    const normalizedExpected = normalizeDate(expectedReturnDate);

    if (searchMode === "KNOWN_DATE" && !normalizedExpected) {
      setError("Select the date you expect to return.");
      return;
    }

    if (
      normalizedExpected &&
      compareDates(normalizedExpected, normalizedDeparture) <= 0
    ) {
      setError("Expected return date must be after the departure date.");
      return;
    }

    const trip = {
      searchMode,
      from: fromSelection,
      to: toSelection,
      departureDate: normalizedDeparture,
      expectedReturnDate: normalizedExpected || undefined,
      classCode,
      quotaCode,
    };

    const sequence = ++searchSequence.current;

    setSearchedTrip(trip);
    setResults([]);
    detailedDates.current.clear();
    detailSequence.current += 1;
    setDetailLoadingDate("");
    setSelectedDepartureDate(normalizedDeparture);
    setSelectedReturnDate("");
    setCalendarMonthIndex(0);
    setLoading(true);

    const normalizeResults = (dates?: DateResult[]) =>
      (dates || [])
        .map((result) => ({
          ...result,
          departureDate: normalizeDate(result.departureDate),
          returnWindowStart: normalizeDate(result.returnWindowStart || ""),
          returnWindowEnd: normalizeDate(result.returnWindowEnd || ""),
          availableReturnDates: (result.availableReturnDates || [])
            .map(normalizeDate)
            .filter(Boolean),
        }))
        .filter((result) => result.departureDate);

    try {
      const response = await fetch("/api/feasibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: searchMode,
          sourceStations: fromSelection.stations.map((code) => ({ code })),
          destinationStations: toSelection.stations.map((code) => ({ code })),
          departureDate: normalizedDeparture,
          expectedReturnDate: normalizedExpected || undefined,
          classCode: classCode.toUpperCase(),
          quotaCode: quotaCode.toUpperCase(),
        }),
      });

      const payload = (await response.json()) as FeasibilityResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to start the search.");
      }

      if (sequence !== searchSequence.current) return;

      // The API returns the 60-day calendar immediately. Show it now instead
      // of hiding the page behind the provider's live-availability work.
      const normalizedInitialResults = normalizeResults(payload.data?.dates);
      setResults(normalizedInitialResults);
      void loadDetailedDeparture(normalizedDeparture, trip);

      if (!payload.jobId) {
        setLoading(false);
        return;
      }

      if (payload.status === "completed") {
        setLoading(false);
        return;
      }

      // Continue receiving live updates while the server processes provider
      // requests. This is the important part: the UI no longer waits for the
      // whole 60-day search to finish before displaying results.
      while (sequence === searchSequence.current) {
        await new Promise((resolve) => setTimeout(resolve, 1200));

        const pollResponse = await fetch(
          `/api/feasibility?jobId=${encodeURIComponent(payload.jobId)}`,
          { cache: "no-store" },
        );
        const poll = (await pollResponse.json()) as FeasibilityResponse;

        if (!pollResponse.ok || !poll.success) {
          throw new Error(poll.error || "Unable to read search progress.");
        }

        if (sequence !== searchSequence.current) return;

        setResults(normalizeResults(poll.data?.dates));

        if (poll.status === "failed") {
          throw new Error(poll.error || "The live availability search failed.");
        }

        if (poll.status === "completed") break;
      }
    } catch (err) {
      if (sequence !== searchSequence.current) return;
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to complete the search.",
      );
    } finally {
      if (sequence === searchSequence.current) {
        setLoading(false);
      }
    }
  }

  async function loadDetailedDeparture(
    date: string,
    tripOverride?: typeof searchedTrip,
  ) {
    const normalized = normalizeDate(date);
    const trip = tripOverride ?? searchedTrip;
    if (!normalized || !trip || detailedDates.current.has(normalized)) return;

    const sequence = ++detailSequence.current;
    detailedDates.current.add(normalized);
    setDetailLoadingDate(normalized);

    const normalizeResults = (dates?: DateResult[]) =>
      (dates || [])
        .map((result) => ({
          ...result,
          departureDate: normalizeDate(result.departureDate),
          returnWindowStart: normalizeDate(result.returnWindowStart || ""),
          returnWindowEnd: normalizeDate(result.returnWindowEnd || ""),
          availableReturnDates: (result.availableReturnDates || []).map(normalizeDate).filter(Boolean),
        }))
        .filter((result) => result.departureDate);

    try {
      const response = await fetch("/api/feasibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mode: "KNOWN_DATE",
          sourceStations: trip.from.stations.map((code) => ({ code })),
          destinationStations: trip.to.stations.map((code) => ({ code })),
          departureDate: normalized,
          expectedReturnDate: trip.expectedReturnDate,
          classCode: trip.classCode.toUpperCase(),
          quotaCode: trip.quotaCode.toUpperCase(),
        }),
      });

      const payload = (await response.json()) as FeasibilityResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load all train options.");

      let detailed = normalizeResults(payload.data?.dates)[0];
      if (!detailed || !payload.jobId) {
        if (detailed && sequence === detailSequence.current) {
          setResults((current) => current.map((item) => item.departureDate === normalized ? detailed! : item));
        }
        return;
      }

      if (payload.status !== "completed") {
        while (sequence === detailSequence.current) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          const pollResponse = await fetch(`/api/feasibility?jobId=${encodeURIComponent(payload.jobId)}`, { cache: "no-store" });
          const poll = (await pollResponse.json()) as FeasibilityResponse;
          if (!pollResponse.ok || !poll.success) throw new Error(poll.error || "Unable to read detailed train search.");
          const next = normalizeResults(poll.data?.dates)[0];
          if (next) {
            detailed = next;
            if (sequence === detailSequence.current) {
              setResults((current) => current.map((item) => item.departureDate === normalized ? next! : item));
            }
          }
          if (poll.status === "failed") throw new Error(poll.error || "Detailed train search failed.");
          if (poll.status === "completed") break;
        }
      }

      if (sequence === detailSequence.current && detailed) {
        setResults((current) => current.map((item) => item.departureDate === normalized ? detailed! : item));
      }
    } catch (err) {
      detailedDates.current.delete(normalized);
      if (sequence === detailSequence.current) {
        console.warn("Detailed train search failed:", err);
      }
    } finally {
      if (sequence === detailSequence.current) setDetailLoadingDate("");
    }
  }

  /*
   * Selecting a calendar result changes ONLY the result currently being
   * inspected. It never changes the search form's departure date.
   */
  function selectDepartureDate(date: string) {
    const normalized = normalizeDate(date);
    if (!normalized) return;

    setSelectedDepartureDate(normalized);
    setSelectedReturnDate("");
    void loadDetailedDeparture(normalized);
  }

  function selectReturnDate(date: string) {
    const normalized = normalizeDate(date);
    if (!normalized) return;

    setSelectedReturnDate(normalized);
  }

  const workingDates = useMemo(
    () =>
      results.filter(
        (result) =>
          result.feasible === true ||
          result.available === true,
      ).length,
    [results],
  );

  const resultCount = results.length;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-700">
            Railway travel planner
          </p>

          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Find travel dates that work
          </h1>

          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
            Check live railway availability and find
            round-trip dates that currently work.
          </p>
        </div>

        <form
          onSubmit={handleSearch}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          {/* SEARCH MODE */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium">
              How are you planning your trip?
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  setSearchMode("KNOWN_DATE")
                }
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  searchMode === "KNOWN_DATE"
                    ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                <div className="font-semibold">
                  I know my travel date
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Keep the departure fixed and find
                  return journeys that work.
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setSearchMode("FLEXIBLE_DATE")
                }
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  searchMode === "FLEXIBLE_DATE"
                    ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                <div className="font-semibold">
                  I&apos;m flexible about my travel date
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Search the upcoming 60 days and
                  discover dates that work.
                </div>
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <LocationPicker
              label="From"
              value={fromQuery}
              suggestions={fromSuggestions}
              selection={fromSelection}
              loading={loadingStations === "FROM"}
              onChange={changeFromQuery}
              onSelectStation={selectFromStation}
              onSelectCity={selectFromCity}
            />

            <LocationPicker
              label="To"
              value={toQuery}
              suggestions={toSuggestions}
              selection={toSelection}
              loading={loadingStations === "TO"}
              onChange={changeToQuery}
              onSelectStation={selectToStation}
              onSelectCity={selectToCity}
            />

            <div>
              <label className="mb-2 block text-sm font-medium">
                Departure date
              </label>

              <input
                type="date"
                value={normalizeDate(departureDate)}
                min={getToday()}
                onChange={(event) =>
                  setDepartureDate(
                    normalizeDate(
                      event.target.value,
                    ),
                  )
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />

              <p className="mt-2 text-sm text-slate-500">
                {searchMode === "KNOWN_DATE"
                  ? "This date stays fixed while we find suitable return options."
                  : "We will search the next 60 days from this date."}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Expected return date
                {searchMode === "FLEXIBLE_DATE" && (
                  <span className="ml-2 font-normal text-slate-400">
                    optional
                  </span>
                )}
              </label>

              <input
                type="date"
                value={normalizeDate(
                  expectedReturnDate,
                )}
                min={
                  departureDate
                    ? addDays(
                        departureDate,
                        1,
                      )
                    : getToday()
                }
                onChange={(event) =>
                  setExpectedReturnDate(
                    normalizeDate(
                      event.target.value,
                    ),
                  )
                }
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />

              <p className="mt-2 text-sm text-slate-500">
                {searchMode === "KNOWN_DATE"
                  ? "Used as the centre of the return search."
                  : "If you have one, we will use it as your preferred return date."}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Class
              </label>

              <select
                value={classCode}
                onChange={(event) =>
                  setClassCode(event.target.value)
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                {CLASS_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Quota
              </label>

              <select
                value={quotaCode}
                onChange={(event) =>
                  setQuotaCode(event.target.value)
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                <option value="GN">General</option>
                <option value="TQ">Tatkal</option>
                <option value="LD">Ladies</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-slate-950 px-5 py-4 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Checking travel availability…"
              : searchMode === "KNOWN_DATE"
                ? "Find return options"
                : "Find travel dates"}
          </button>
        </form>

        {searchedTrip && (
          <section className="mt-8">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <h2 className="text-2xl font-bold">
                  {searchedTrip.searchMode ===
                  "KNOWN_DATE"
                    ? "Your travel date"
                    : "Travel dates"}
                </h2>

                <p className="mt-1 text-sm text-slate-600">
                  {searchedTrip.searchMode ===
                  "KNOWN_DATE"
                    ? "Your departure stays fixed. Choose any currently confirmed return date."
                    : `${workingDates} of ${calendarDates.length} dates currently have a complete outbound and return option.`}
                </p>
              </div>

              <div className="text-sm text-slate-500">
                {searchedTrip.from.label} →{" "}
                {searchedTrip.to.label}
              </div>
            </div>

            {/* FLEXIBLE MODE CALENDAR */}
            {searchedTrip.searchMode ===
              "FLEXIBLE_DATE" &&
              calendarMonths.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-5 flex items-center justify-between">
                    <button
                      type="button"
                      disabled={
                        calendarMonthIndex === 0
                      }
                      onClick={() =>
                        setCalendarMonthIndex(
                          (value) =>
                            Math.max(
                              0,
                              value - 1,
                            ),
                        )
                      }
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      Previous
                    </button>

                    <h3 className="font-semibold">
                      {visibleMonthDates.length
                        ? monthLabel(
                            visibleMonthDates[0],
                          )
                        : ""}
                    </h3>

                    <button
                      type="button"
                      disabled={
                        calendarMonthIndex >=
                        calendarMonths.length - 1
                      }
                      onClick={() =>
                        setCalendarMonthIndex(
                          (value) =>
                            Math.min(
                              calendarMonths.length -
                                1,
                              value + 1,
                            ),
                        )
                      }
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
                    {visibleMonthDates.map(
                      (date) => {
                        const result =
                          results.find(
                            (item) =>
                              normalizeDate(
                                item.departureDate,
                              ) === date,
                          );

                        const checking = result?.status === "checking";
                        const available =
                          result?.feasible === true ||
                          result?.available === true;

                        const selected =
                          selectedDepartureDate ===
                          date;

                        return (
                          <button
                            key={date}
                            type="button"
                            onClick={() =>
                              selectDepartureDate(
                                date,
                              )
                            }
                            className={`rounded-xl border p-3 text-left transition ${
                              selected
                                ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100"
                                : available
                                  ? "border-emerald-300 bg-emerald-50 hover:border-emerald-500"
                                  : "border-red-200 bg-red-50 hover:border-red-400"
                            }`}
                          >
                            <div className="text-xs font-medium text-slate-500">
                              {dayName(date)}
                            </div>

                            <div className="mt-1 text-lg font-bold">
                              {dateObject(
                                date,
                              )?.getDate()}
                            </div>

                            <div className="mt-1 text-xs font-medium">
                              {checking
                                ? "Checking…"
                                : result
                                  ? available
                                    ? "Available"
                                    : "No complete trip"
                                  : loading
                                    ? "Checking…"
                                    : "No data"}
                            </div>
                          </button>
                        );
                      },
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-emerald-500" />
                      Complete trip available
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-red-400" />
                      No complete trip currently available
                    </div>
                  </div>
                </div>
              )}

            {/* SELECTED DEPARTURE */}
            {selectedResult && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col justify-between gap-4 sm:flex-row">
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Selected departure
                    </p>

                    <h3 className="mt-1 text-2xl font-bold">
                      {formatDate(
                        selectedDepartureDate,
                      )}
                    </h3>
                  </div>

                  {calculatedReturnWindow && (
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Return search window
                      </p>

                      <p className="mt-1 font-semibold">
                        {formatDate(
                          calculatedReturnWindow.start,
                        )}{" "}
                        –{" "}
                        {formatDate(
                          calculatedReturnWindow.end,
                        )}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-lg font-semibold">
                      Available outbound trains
                    </h4>
                    {detailLoadingDate === selectedDepartureDate && (
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                        Checking all nearby-station trains…
                      </span>
                    )}
                  </div>

                  {selectedResult.outboundOptions
                    ?.length ? (
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {selectedResult.outboundOptions.map(
                        (train, index) => (
                          <TrainCard
                            key={`outbound-${train.trainNumber}-${index}`}
                            train={train}
                          />
                        ),
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                      {detailLoadingDate === selectedDepartureDate
                        ? "Checking all nearby-station departures…"
                        : "No currently confirmed outbound train was found for this date."}
                    </div>
                  )}
                </div>

                <div className="mt-8">
                  <h4 className="text-lg font-semibold">
                    Available return dates
                  </h4>

                  <p className="mt-1 text-sm text-slate-500">
                    Choose any currently confirmed
                    return date. Selecting one does not
                    change your departure.
                  </p>

                  {visibleAvailableReturnDates.length >
                  0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {visibleAvailableReturnDates.map(
                        (date) => {
                          const selected =
                            selectedReturnDate ===
                            date;

                          const isExpected =
                            date ===
                            searchedTrip.expectedReturnDate;

                          return (
                            <button
                              key={date}
                              type="button"
                              onClick={() =>
                                selectReturnDate(
                                  date,
                                )
                              }
                              className={`rounded-xl border px-4 py-3 text-left transition ${
                                selected
                                  ? "border-blue-600 bg-blue-600 text-white"
                                  : "border-slate-200 bg-white hover:border-blue-400"
                              }`}
                            >
                              <div className="font-semibold">
                                {formatShortDate(date)}
                              </div>

                              <div
                                className={`mt-1 text-xs ${
                                  selected
                                    ? "text-blue-100"
                                    : "text-slate-500"
                                }`}
                              >
                                {isExpected
                                  ? "Expected return"
                                  : dayName(date)}
                              </div>
                            </button>
                          );
                        },
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      No currently confirmed return
                      date was found in this return search.
                    </div>
                  )}
                </div>

                {searchedTrip.expectedReturnDate && (
                  <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
                    <span className="font-medium">
                      Expected return:
                    </span>{" "}
                    {formatDate(
                      searchedTrip.expectedReturnDate,
                    )}

                    {visibleAvailableReturnDates.includes(
                      searchedTrip.expectedReturnDate,
                    ) ? (
                      <span className="ml-2 font-semibold text-emerald-700">
                        Currently available
                      </span>
                    ) : (
                      <span className="ml-2 font-semibold text-amber-700">
                        Not currently available
                      </span>
                    )}
                  </div>
                )}

                {selectedReturnDate && (
                  <div className="mt-8">
                    <div>
                      <h4 className="text-lg font-semibold">
                        Return trains
                      </h4>

                      <p className="mt-1 text-sm text-slate-500">
                        {formatDate(
                          selectedReturnDate,
                        )}{" "}
                        •{" "}
                        {searchedTrip.to.label} →{" "}
                        {searchedTrip.from.label}
                      </p>
                    </div>

                    {selectedReturnOptions.length >
                    0 ? (
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {selectedReturnOptions.map(
                          (train, index) => (
                            <TrainCard
                              key={`return-${train.trainNumber}-${index}`}
                              train={train}
                            />
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                        No currently confirmed return
                        train details were found for
                        this date.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {resultCount === 0 && !loading && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <h3 className="font-semibold">
                  No timetable results
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  No matching train routes were found
                  for the selected locations.
                </p>
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">
                How this result works
              </h3>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                City searches consider the relevant
                railway stations in that city. Outbound
                and return routes are discovered
                independently, so the return journey can
                use a different station pair. Only
                confirmed live availability is counted;
                RAC and waitlisted status are not treated
                as confirmed.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

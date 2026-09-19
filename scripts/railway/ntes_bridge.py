import sys
import json
from pathlib import Path
from datetime import datetime

from ntes import NTESClient


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parents[2]

RAILPULL_ROOT = BASE_DIR / "data" / "railpull"
SCHEDULE_DIR = RAILPULL_ROOT / "data" / "raw" / "schedules"


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------

def emit(payload, exit_code=0):
    """
    Write exactly one JSON response to stdout.

    The Next.js process depends on stdout containing valid JSON.
    We therefore never use print() for bridge responses.
    """

    try:
        output = json.dumps(
            payload,
            ensure_ascii=False,
            default=str,
        )

        sys.stdout.write(output)
        sys.stdout.write("\n")
        sys.stdout.flush()

    except Exception as error:
        # Last-resort ASCII response.
        fallback = json.dumps(
            {
                "success": False,
                "error": f"Failed to serialize bridge response: {error}",
            }
        )

        try:
            sys.stdout.write(fallback + "\n")
            sys.stdout.flush()
        except Exception:
            pass

        exit_code = 1

    if exit_code != 0:
        sys.exit(exit_code)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def clean(value):
    if value is None:
        return ""

    return str(value).strip()


def parse_date(value):
    value = clean(value)

    formats = (
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%Y-%m-%d",
    )

    for fmt in formats:
        try:
            return datetime.strptime(
                value,
                fmt,
            ).strftime("%Y-%m-%d")

        except ValueError:
            pass

    return None


# ---------------------------------------------------------------------------
# Exact NTES operating dates
# ---------------------------------------------------------------------------

def extract_run_dates(schedule):
    """
    Extract the exact dates on which the train is scheduled to start.

    We intentionally use vStartDateList rather than converting the
    timetable into weekday labels.
    """

    raw_dates = schedule.get("vStartDateList") or []

    if isinstance(raw_dates, str):
        raw_dates = [
            value
            for value in raw_dates
            .replace(",", " ")
            .split()
            if value
        ]

    result = set()

    if not isinstance(raw_dates, list):
        return result

    for value in raw_dates:

        if isinstance(value, dict):
            value = (
                value.get("date")
                or value.get("startDate")
                or value.get("journeyDate")
            )

        parsed = parse_date(value)

        if parsed:
            result.add(parsed)

    return result


# ---------------------------------------------------------------------------
# Class extraction
# ---------------------------------------------------------------------------

def extract_classes(schedule):

    values = []

    for key in (
        "ClassOfTravel",
        "classes",
        "Classes",
        "classOfTravel",
        "classList",
        "ClassList",
    ):

        value = schedule.get(key)

        if isinstance(value, str):
            values.append(value)

        elif isinstance(value, list):
            values.extend(
                str(item)
                for item in value
                if item
            )

    for key in (
        "vClassList",
        "VClassList",
    ):

        value = schedule.get(key)

        if not isinstance(value, list):
            continue

        for item in value:

            if isinstance(item, dict):

                for field in (
                    "classCode",
                    "ClassCode",
                    "code",
                    "Code",
                    "class",
                ):

                    if item.get(field):
                        values.append(
                            str(item[field])
                        )

            elif item:
                values.append(str(item))

    tokens = []

    for value in values:

        normalized = (
            str(value)
            .replace("|", ",")
            .replace("/", ",")
            .replace(";", ",")
        )

        for part in normalized.split(","):

            part = part.strip().upper()

            if part and part not in tokens:
                tokens.append(part)

    return ",".join(tokens)


# ---------------------------------------------------------------------------
# Stop helpers
# ---------------------------------------------------------------------------

def stop_code(stop):

    if not isinstance(stop, dict):
        return ""

    return clean(
        stop.get("StationCode")
        or stop.get("stationCode")
        or stop.get("code")
    ).upper()


def stop_name(stop):

    if not isinstance(stop, dict):
        return ""

    return clean(
        stop.get("StationName")
        or stop.get("stationName")
        or stop.get("name")
    )


# ---------------------------------------------------------------------------
# Build route-specific train
# ---------------------------------------------------------------------------

def build_route_train(
    schedule,
    source,
    destination,
    journey_date,
):
    """
    Determine whether the train's actual timetable contains:

        source -> destination

    in that order.

    Availability is checked later against this exact segment.
    """

    stops = schedule.get("stations") or []

    if not isinstance(stops, list):
        return None

    if len(stops) < 2:
        return None

    source = source.upper()
    destination = destination.upper()

    source_index = None
    destination_index = None

    for index, stop in enumerate(stops):

        code = stop_code(stop)

        if source_index is None:

            if code == source:
                source_index = index

            continue

        if code == destination:
            destination_index = index
            break

    if source_index is None:
        return None

    if destination_index is None:
        return None

    if destination_index <= source_index:
        return None

    source_stop = stops[source_index]
    destination_stop = stops[destination_index]

    train_number = clean(
        schedule.get("TrainNumber")
        or schedule.get("trainNumber")
    )

    if not train_number:
        return None

    return {
        "trainNumber": train_number,

        "trainName": clean(
            schedule.get("TrainName")
            or schedule.get("trainName")
        ),

        "source": clean(
            schedule.get("Source")
            or schedule.get("source")
        ),

        "destination": clean(
            schedule.get("Destination")
            or schedule.get("destination")
        ),

        "sourceName": clean(
            schedule.get("SourceName")
            or schedule.get("sourceName")
        ),

        "destinationName": clean(
            schedule.get("DestinationName")
            or schedule.get("destinationName")
        ),

        "fromStation": source,

        "toStation": destination,

        "fromStationName": stop_name(
            source_stop
        ),

        "toStationName": stop_name(
            destination_stop
        ),

        "departureTime": clean(
            source_stop.get("STD")
            or source_stop.get("departure")
            or source_stop.get("DepTime")
        ),

        "arrivalTime": clean(
            destination_stop.get("STA")
            or destination_stop.get("arrival")
            or destination_stop.get("ArrTime")
        ),

        "travelTime": clean(
            schedule.get("TravelTime")
            or schedule.get("travelTime")
        ),

        "classes": extract_classes(schedule),

        "runningDays": clean(
            schedule.get("DaysOfRun")
            or schedule.get("runningDays")
        ),

        "trainType": clean(
            schedule.get("TrainType")
            or schedule.get("trainType")
        ),

        "journeyDate": journey_date,
    }


# ---------------------------------------------------------------------------
# DATE-FIRST TIMETABLE QUERY
# ---------------------------------------------------------------------------

def handle_trains_on_dates():

    if len(sys.argv) < 3:
        raise ValueError(
            "Usage: trains_on_dates JSON_PAYLOAD"
        )

    payload_text = sys.argv[2]

    if not payload_text:
        raise ValueError(
            "Empty trains_on_dates payload."
        )

    try:
        payload = json.loads(payload_text)

    except json.JSONDecodeError as error:
        raise ValueError(
            f"Invalid trains_on_dates JSON payload: {error}"
        )

    if not isinstance(payload, dict):
        raise ValueError(
            "trains_on_dates payload must be a JSON object."
        )

    sources = [
        clean(value).upper()
        for value in payload.get("sources", [])
        if clean(value)
    ]

    destinations = [
        clean(value).upper()
        for value in payload.get("destinations", [])
        if clean(value)
    ]

    dates = [
        clean(value)
        for value in payload.get("dates", [])
        if clean(value)
    ]

    if not sources:
        raise ValueError(
            "sources are required"
        )

    if not destinations:
        raise ValueError(
            "destinations are required"
        )

    if not dates:
        raise ValueError(
            "dates are required"
        )

    # Normalize dates.
    normalized_dates = []

    for value in dates:

        parsed = parse_date(value)

        if parsed:
            normalized_dates.append(parsed)

        else:
            raise ValueError(
                f"Invalid journey date: {value}"
            )

    # Preserve order while removing duplicates.
    dates = list(
        dict.fromkeys(normalized_dates)
    )

    requested_dates = set(dates)

    result = {
        date: []
        for date in dates
    }

    if not SCHEDULE_DIR.exists():
        raise RuntimeError(
            "NTES schedule directory not found: "
            f"{SCHEDULE_DIR}"
        )

    schedule_files = sorted(
        SCHEDULE_DIR.glob("*.json")
    )

    # -----------------------------------------------------------------------
    # Scan the local NTES timetable.
    #
    # IMPORTANT:
    #
    # We do NOT call NTES live search here.
    # We do NOT call RailRadar here.
    #
    # This is only timetable/date discovery.
    # -----------------------------------------------------------------------

    for file_path in schedule_files:

        try:

            schedule = json.loads(
                file_path.read_text(
                    encoding="utf-8"
                )
            )

        except Exception:
            # One bad schedule must not break the whole search.
            continue

        if not isinstance(schedule, dict):
            continue

        run_dates = extract_run_dates(
            schedule
        )

        matching_dates = (
            run_dates.intersection(
                requested_dates
            )
        )

        if not matching_dates:
            continue

        for source in sources:

            for destination in destinations:

                if source == destination:
                    continue

                for journey_date in matching_dates:

                    route_train = build_route_train(
                        schedule,
                        source,
                        destination,
                        journey_date,
                    )

                    if route_train is None:
                        continue

                    result[journey_date].append(
                        route_train
                    )

    # -----------------------------------------------------------------------
    # Deduplicate
    # -----------------------------------------------------------------------

    for date in result:

        unique = {}

        for train in result[date]:

            key = (
                train.get("trainNumber"),
                train.get("fromStation"),
                train.get("toStation"),
            )

            unique[key] = train

        result[date] = list(
            unique.values()
        )

        # Stable ordering for the frontend.
        result[date].sort(
            key=lambda train: (
                clean(
                    train.get(
                        "departureTime"
                    )
                ),
                clean(
                    train.get(
                        "trainNumber"
                    )
                ),
            )
        )

    # -----------------------------------------------------------------------
    # Return JSON
    # -----------------------------------------------------------------------

    return {
        "success": True,
        "dates": result,
        "scheduleFiles": len(
            schedule_files
        ),
    }


# ---------------------------------------------------------------------------
# Legacy NTES operations
# ---------------------------------------------------------------------------

def normalize_train(train):

    if not isinstance(train, dict):
        return None

    train_number = clean(
        train.get("TrainNumber")
        or train.get("trainNumber")
    )

    if not train_number:
        return None

    return {
        "trainNumber": train_number,

        "trainName": clean(
            train.get("TrainName")
            or train.get("trainName")
        ),

        "source": clean(
            train.get("Source")
            or train.get("source")
        ),

        "destination": clean(
            train.get("Destination")
            or train.get("destination")
        ),

        "sourceName": clean(
            train.get("SourceName")
            or train.get("sourceName")
        ),

        "destinationName": clean(
            train.get("DestinationName")
            or train.get("destinationName")
        ),

        "fromStation": clean(
            train.get("FromStation")
            or train.get("fromStation")
        ),

        "toStation": clean(
            train.get("toStation")
            or train.get("ToStation")
        ),

        "departureTime": clean(
            train.get("DepTimeFrom")
            or train.get("departureTime")
        ),

        "arrivalTime": clean(
            train.get("ArrTimeTo")
            or train.get("arrivalTime")
        ),

        "travelTime": clean(
            train.get("TravelTime")
            or train.get("travelTime")
        ),

        "classes": clean(
            train.get("ClassOfTravel")
            or train.get("classes")
        ),

        "runningDays": clean(
            train.get("DayOfRun")
            or train.get("runningDays")
        ),

        "trainType": clean(
            train.get("TrainType")
            or train.get("trainType")
        ),
    }


def handle_trains_between(client):

    if len(sys.argv) < 4:
        raise ValueError(
            "Usage: trains_between SOURCE DESTINATION"
        )

    source = clean(
        sys.argv[2]
    ).upper()

    destination = clean(
        sys.argv[3]
    ).upper()

    result = client.trains_between(
        source,
        destination,
    )

    trains = (
        result.get("Trains", [])
        if isinstance(result, dict)
        else []
    )

    normalized = []

    for train in trains:

        normalized_train = normalize_train(
            train
        )

        if normalized_train:
            normalized.append(
                normalized_train
            )

    return {
        "success": True,
        "source": source,
        "destination": destination,
        "count": len(normalized),
        "trains": normalized,
    }


def handle_schedule(client):

    if len(sys.argv) < 3:
        raise ValueError(
            "Usage: schedule TRAIN_NUMBER [START_DATE]"
        )

    train_number = clean(
        sys.argv[2]
    )

    start_date = (
        clean(sys.argv[3])
        if len(sys.argv) >= 4
        else ""
    )

    result = client.schedule(
        train_number,
        start_date,
    )

    return {
        "success": True,
        "trainNumber": train_number,
        "schedule": result,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():

    try:

        if len(sys.argv) < 2:
            emit(
                {
                    "success": False,
                    "error": "Missing command",
                },
                exit_code=1,
            )

            return

        command = sys.argv[1]

        if command == "trains_on_dates":

            result = handle_trains_on_dates()

            emit(result)

            return

        if command == "trains_between":

            client = NTESClient()

            result = handle_trains_between(
                client
            )

            emit(result)

            return

        if command == "schedule":

            client = NTESClient()

            result = handle_schedule(
                client
            )

            emit(result)

            return

        raise ValueError(
            f"Unknown command: {command}"
        )

    except Exception as error:

        emit(
            {
                "success": False,
                "error": str(error),
            },
            exit_code=1,
        )


if __name__ == "__main__":
    main()
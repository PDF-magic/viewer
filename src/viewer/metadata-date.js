const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parsePdfDate(value) {
  const match = value.match(
    /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})'?)?$/i,
  );
  if (!match || (!match[7] && !match[8])) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = Number.parseInt(match[6] || "0", 10);
  const localTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    localTime.getUTCFullYear() !== year ||
    localTime.getUTCMonth() !== month - 1 ||
    localTime.getUTCDate() !== day ||
    localTime.getUTCHours() !== hour ||
    localTime.getUTCMinutes() !== minute ||
    localTime.getUTCSeconds() !== second
  ) {
    return null;
  }

  if (match[7]) {
    return localTime;
  }

  const offsetHours = Number.parseInt(match[9], 10);
  const offsetMinutes = Number.parseInt(match[10], 10);
  if (offsetHours > 23 || offsetMinutes > 59) {
    return null;
  }

  const offset = (offsetHours * 60 + offsetMinutes) * (match[8] === "+" ? 1 : -1);
  return new Date(localTime.getTime() - offset * 60_000);
}

function parseMetadataDate(value) {
  if (value.startsWith("D:")) {
    return parsePdfDate(value);
  }

  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatMetadataDate(value) {
  if (typeof value !== "string") {
    return value;
  }

  const date = parseMetadataDate(value.trim());
  if (!date) {
    return value;
  }

  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} at ${date.getUTCHours()}:${minutes} UTC`;
}

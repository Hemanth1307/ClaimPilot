export function formatDateTime(value) {
  if (!value) return "";

  let date;
  if (value instanceof Date) {
    date = value;
  } else {
    const text = String(value).trim();
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text.replace(" ", "T")}Z`
      : text;
    date = new Date(normalized);
  }

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const dayPeriod = get("dayPeriod").toUpperCase();

  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}:${get("second")} ${dayPeriod}`;
}

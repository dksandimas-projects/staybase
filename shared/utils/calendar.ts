export interface CalendarEventInput {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date | string;
  end: Date | string;
  allDay?: boolean;
  brand?: string;
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return new Date(value.getTime());
  return new Date(value);
}

function formatUtcBasic(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function formatDateOnly(value: Date | string): string {
  const date = toDate(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let remaining = line;
  chunks.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    chunks.push(` ${remaining.slice(0, 74)}`);
    remaining = remaining.slice(74);
  }
  return chunks.join("\r\n");
}

export function buildIcsContent(input: CalendarEventInput): string {
  const {
    uid,
    title,
    description,
    location,
    start,
    end,
    allDay = false,
    brand = "spark-inn"
  } = input;
  const stamp = formatUtcBasic(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${brand}//Booking//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`
  ];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateOnly(end)}`);
  } else {
    lines.push(`DTSTART:${formatUtcBasic(toDate(start))}`);
    lines.push(`DTEND:${formatUtcBasic(toDate(end))}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(title)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function buildGoogleCalendarUrl(input: CalendarEventInput): string {
  const { title, description, location, start, end, allDay = false } = input;
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", title);
  if (description) params.set("details", description);
  if (location) params.set("location", location);

  if (allDay) {
    const startStr = formatDateOnly(start);
    const endStr = formatDateOnly(toDate(end));
    params.set("dates", `${startStr}/${endStr}`);
  } else {
    params.set("dates", `${formatUtcBasic(toDate(start))}/${formatUtcBasic(toDate(end))}`);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadIcsFile(filename: string, content: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

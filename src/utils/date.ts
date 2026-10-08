import { DateStyle } from "../types";

/**
 * Formats a Date object into human-friendly relative time (e.g., 'just now', '5m ago', '3 days ago').
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 30) {
    return "just now";
  }
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffHour < 24) {
    return diffHour === 1 ? "1 hour ago" : `${diffHour} hours ago`;
  }
  if (diffDay === 1) {
    return "yesterday";
  }
  if (diffDay < 30) {
    return `${diffDay} days ago`;
  }
  if (diffMonth < 12) {
    return diffMonth === 1 ? "1 month ago" : `${diffMonth} months ago`;
  }
  const years = Math.max(1, diffYear);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/**
 * Formats a Date object into a short clean string (e.g. 'Sep 28, 2026').
 */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const MONTH_NAMES_SHORT = [
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

const MONTH_NAMES_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_NAMES_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Formats a Date object using custom tokens (e.g. 'DD/MM/YYYY HH:mm').
 * Supports:
 * - YYYY (2026), YY (26)
 * - MMMM (September), MMM (Sep), MM (09), M (9)
 * - DD (25), D (25)
 * - dddd (Friday), ddd (Fri)
 * - HH (14), H (14) [24-hour]
 * - hh (02), h (2) [12-hour]
 * - mm (10), m (10)
 * - ss (05), s (5)
 * - A (AM/PM), a (am/pm)
 * - [escaped text]
 */
export function formatCustomDate(
  date: Date,
  pattern: string = "DD/MM/YYYY HH:mm",
): string {
  if (!pattern || typeof pattern !== "string") {
    pattern = "DD/MM/YYYY HH:mm";
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const dayOfWeek = date.getDay();
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const isPm = hours24 >= 12;

  const pad2 = (n: number): string => String(n).padStart(2, "0");

  const tokenMap: Record<string, string> = {
    YYYY: String(year),
    YY: String(year).slice(-2),
    MMMM: MONTH_NAMES_FULL[month] !== undefined ? MONTH_NAMES_FULL[month] : "",
    MMM: MONTH_NAMES_SHORT[month] !== undefined ? MONTH_NAMES_SHORT[month] : "",
    MM: pad2(month + 1),
    M: String(month + 1),
    dddd:
      DAY_NAMES_FULL[dayOfWeek] !== undefined ? DAY_NAMES_FULL[dayOfWeek] : "",
    ddd:
      DAY_NAMES_SHORT[dayOfWeek] !== undefined
        ? DAY_NAMES_SHORT[dayOfWeek]
        : "",
    DD: pad2(day),
    D: String(day),
    HH: pad2(hours24),
    H: String(hours24),
    hh: pad2(hours12),
    h: String(hours12),
    mm: pad2(minutes),
    m: String(minutes),
    ss: pad2(seconds),
    s: String(seconds),
    A: isPm ? "PM" : "AM",
    a: isPm ? "pm" : "am",
  };

  const regex =
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|m|ss|s|A|a/g;

  return pattern.replace(regex, (match, escapedText) => {
    if (escapedText !== undefined) {
      return escapedText;
    }
    const tokenValue = tokenMap[match];
    if (tokenValue !== undefined) {
      return tokenValue;
    }
    return match;
  });
}

/**
 * Formats a Date object into ISO/standard date string (e.g. '2026-09-28 15:30').
 */
export function formatAbsoluteDate(date: Date): string {
  return formatCustomDate(date, "YYYY-MM-DD HH:mm");
}

/**
 * Formats a Date object according to the chosen style.
 */
export function formatDateByStyle(date: Date, style: DateStyle): string {
  switch (style) {
    case "absolute":
      return formatAbsoluteDate(date);
    case "short":
      return formatShortDate(date);
    case "relative":
    default:
      return formatRelativeTime(date);
  }
}

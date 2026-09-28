import { DateStyle } from '../types';

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
    return 'just now';
  }
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffHour < 24) {
    return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`;
  }
  if (diffDay === 1) {
    return 'yesterday';
  }
  if (diffDay < 30) {
    return `${diffDay} days ago`;
  }
  if (diffMonth < 12) {
    return diffMonth === 1 ? '1 month ago' : `${diffMonth} months ago`;
  }
  return diffYear === 1 ? '1 year ago' : `${diffYear} years ago`;
}

/**
 * Formats a Date object into a short clean string (e.g. 'Sep 28, 2026').
 */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Formats a Date object into ISO/standard date string (e.g. '2026-09-28 15:30').
 */
export function formatAbsoluteDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Formats a Date object according to the chosen style.
 */
export function formatDateByStyle(date: Date, style: DateStyle): string {
  switch (style) {
    case 'absolute':
      return formatAbsoluteDate(date);
    case 'short':
      return formatShortDate(date);
    case 'relative':
    default:
      return formatRelativeTime(date);
  }
}

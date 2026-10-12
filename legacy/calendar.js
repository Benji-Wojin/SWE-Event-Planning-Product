(function (root) {
  'use strict';
  // Dates are event-local calendar days. Elapsed durations still use timestamps.
  const formatters = new Map();
  function dayKey(value = new Date(), timeZone = 'UTC', offset = 0) {
    const zone = timeZone || 'UTC';
    let formatter = formatters.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
      if (formatters.size >= 32) formatters.clear();
      formatters.set(zone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (!offset) return day;
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  root.GatherCalendar = { dayKey };
})(typeof window !== 'undefined' ? window : globalThis);

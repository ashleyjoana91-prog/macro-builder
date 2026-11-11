// Turns meals into a calendar file (.ics) that any calendar app can open:
// Apple Calendar, Outlook, Google (via the phone's calendar app) and others.
// Nothing is stored here - the app sends the meal details, this sends back the file.

export default function handler(req, res) {
  let events = [];
  try {
    events = JSON.parse(String(req.query.e || '[]'));
  } catch {
    events = [];
  }

  const isStamp = (s) => /^\d{8}T\d{6}Z$/.test(String(s || ''));
  const valid = Array.isArray(events) ? events.filter((ev) => ev && isStamp(ev.s) && isStamp(ev.e)).slice(0, 20) : [];

  if (!valid.length) {
    res.status(400).send('Nothing to add to the calendar.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Macro Builder//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

  valid.forEach((ev, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}@macro-builder`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ev.s}`,
      `DTEND:${ev.e}`,
      `SUMMARY:${escapeText(ev.t)}`,
      `DESCRIPTION:${escapeText(ev.d)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="macros.ics"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(lines.map(fold).join('\r\n') + '\r\n');
}

function escapeText(s) {
  return String(s || '')
    .slice(0, 1000)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Calendar files need long lines split up
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ' + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join('\r\n');
}

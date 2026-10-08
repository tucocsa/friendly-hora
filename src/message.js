// Текст сповіщення про зміну графіка. Чистий модуль без I/O.

const MINUTES_PER_DAY = 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayTitle = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('uk-UA', { weekday: 'short', timeZone: 'UTC' });

// Дати в schedule.json календарні, тому форматуються як північ UTC, без зсуву поясу.
const asDate = (date) => new Date(`${date}T00:00:00Z`);

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// Інтервали одного виду з усіх днів. Інтервал до 24:00 зливається з інтервалом від 00:00
// наступної дати, щоб нічне відключення не виглядало як два окремі.
function spans(days, kind) {
  const result = [];
  days.forEach((day, index) => {
    for (const interval of day[kind]) {
      const [start, end] = interval.split('-').map(toMinutes);
      const last = result.at(-1);
      const continuesLast = start === 0
        && last?.end === MINUTES_PER_DAY
        && last.endIndex === index - 1
        && asDate(day.date) - asDate(days[index - 1].date) === DAY_MS;
      if (continuesLast) {
        Object.assign(last, { endIndex: index, end });
      } else {
        result.push({ startIndex: index, start, endIndex: index, end });
      }
    }
  });
  return result;
}

function formatSpan(span, days) {
  if (span.endIndex === span.startIndex) return `${formatTime(span.start)}–${formatTime(span.end)}`;
  return `${formatTime(span.start)} – ${weekday.format(asDate(days[span.endIndex].date))} ${formatTime(span.end)}`;
}

// schedule.json + дати, що змінилися → текст повідомлення.
export function formatMessage({ days }, changed) {
  const off = spans(days, 'off');
  const maybe = spans(days, 'maybe');

  const sections = days.map((day, index) => {
    const title = dayTitle.format(asDate(day.date));
    const lines = [`${title[0].toUpperCase()}${title.slice(1)}${changed.includes(day.date) ? ' (оновлено)' : ''}`];
    const dayOff = off.filter((span) => span.startIndex === index);
    const dayMaybe = maybe.filter((span) => span.startIndex === index);

    if (dayOff.length) lines.push(`Без світла: ${dayOff.map((span) => formatSpan(span, days)).join(', ')}`);
    if (dayMaybe.length) lines.push(`Можливі відключення: ${dayMaybe.map((span) => formatSpan(span, days)).join(', ')}`);
    if (!dayOff.length && !dayMaybe.length) {
      // Відключення цього дня вже показане в попередньому як нічне.
      lines.push(day.off.length || day.maybe.length ? 'Інших відключень немає' : 'Відключень немає');
    }
    return lines.join('\n');
  });

  return ['Графік відключень змінився', ...sections].join('\n\n');
}

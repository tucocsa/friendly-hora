// Розбір DisconSchedule.fact на інтервали без світла. Чистий модуль без I/O.

import { isDeepStrictEqual } from 'node:util';

export const TIME_ZONE = 'Europe/Kyiv';

const HOURS_PER_DAY = 24;
const SLOT_MINUTES = 30;

// Статус години → стан її двох половин: 'off' — світла немає, 'maybe' — можливе відключення, null — світло є.
const HALVES = new Map([
  ['yes', [null, null]],
  ['no', ['off', 'off']],
  ['first', ['off', null]],
  ['second', [null, 'off']],
  ['maybe', ['maybe', 'maybe']],
  ['mfirst', ['maybe', null]],
  ['msecond', [null, 'maybe']],
]);

const kyivFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

// Момент часу → '2026-10-08T20:50:00+03:00'. Зсув береться з tzdata, а не хардкодиться.
export function kyivIso(date) {
  const p = Object.fromEntries(kyivFormat.formatToParts(date).map(({ type, value }) => [type, value]));
  const offset = p.timeZoneName.replace('GMT', '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

// Ключ fact.data (unix-секунди півночі за Києвом) → '2026-10-08'.
export function kyivDate(unixSeconds) {
  return kyivIso(new Date(unixSeconds * 1000)).slice(0, 10);
}

function slotTime(slot) {
  const minutes = slot * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function collectIntervals(slots, kind) {
  const intervals = [];
  let start = null;
  // Прохід на один слот далі кінця доби закриває інтервал, що триває до 24:00.
  for (let slot = 0; slot <= slots.length; slot++) {
    if (slots[slot] === kind) {
      start ??= slot;
    } else if (start !== null) {
      intervals.push(`${slotTime(start)}-${slotTime(slot)}`);
      start = null;
    }
  }
  return intervals;
}

// Години "1"…"24" однієї черги → { off: ['07:00-14:30', …], maybe: […] }.
export function parseDay(hours) {
  const slots = [];
  for (let hour = 1; hour <= HOURS_PER_DAY; hour++) {
    const halves = HALVES.get(hours[hour]);
    if (!halves) throw new Error(`Невідомий статус години ${hour}: ${JSON.stringify(hours[hour])}`);
    slots.push(...halves);
  }
  return { off: collectIntervals(slots, 'off'), maybe: collectIntervals(slots, 'maybe') };
}

// DisconSchedule.fact → вміст schedule.json без checked_at.
export function buildSchedule(fact, group) {
  const keys = Object.keys(fact?.data ?? {}).sort((a, b) => a - b);
  if (keys.length === 0) throw new Error('fact.data порожній');

  const days = keys.map((key) => {
    const date = kyivDate(Number(key));
    const hours = fact.data[key][group];
    if (!hours) throw new Error(`Немає черги ${group} за ${date}`);
    return { date, ...parseDay(hours) };
  });

  return { group, source_update: fact.update, days };
}

// Порівнюються черга й інтервали. source_update і checked_at не враховуються:
// версія ДТЕК змінюється й тоді, коли для нашої черги нічого не змінилося.
export function sameSchedule(a, b) {
  return a.group === b.group && isDeepStrictEqual(a.days, b.days);
}

// Дати, для яких з'явився графік або змінилися інтервали. Минулі дні, що зникли з графіка,
// не рахуються: інакше щоночі приходило б сповіщення без жодних змін.
export function changedDates(current, next) {
  const before = new Map(current?.group === next.group ? current.days.map((day) => [day.date, day]) : []);
  return next.days.filter((day) => !isDeepStrictEqual(before.get(day.date), day)).map((day) => day.date);
}

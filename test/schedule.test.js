import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildSchedule, kyivDate, kyivIso, parseDay, sameSchedule } from '../src/schedule.js';

const fact = JSON.parse(await readFile(new URL('./fixtures/fact-2026-10-08.json', import.meta.url), 'utf8'));

const allHours = (status) => Object.fromEntries(Array.from({ length: 24 }, (_, i) => [String(i + 1), status]));

test('фікстура 8–9 жовтня розбирається на очікувані інтервали', () => {
  assert.deepEqual(buildSchedule(fact, 'GPV5.1'), {
    group: 'GPV5.1',
    source_update: '08.10.2026 20:42',
    days: [
      { date: '2026-10-08', off: ['00:00-00:30', '07:00-14:30', '17:30-21:00'], maybe: [] },
      { date: '2026-10-09', off: ['14:30-18:30'], maybe: [] },
    ],
  });
});

test('ключ дня переводиться в дату за Києвом, а не за UTC', () => {
  assert.equal(kyivDate(1791406800), '2026-10-08');
});

test('зсув у checked_at береться з поясу, а не хардкодиться', () => {
  assert.equal(kyivIso(new Date('2026-10-08T17:50:00Z')), '2026-10-08T20:50:00+03:00');
  assert.equal(kyivIso(new Date('2026-12-01T10:00:00Z')), '2026-12-01T12:00:00+02:00');
});

test('maybe-статуси збираються окремо від точних відключень', () => {
  const hours = { ...allHours('yes'), 10: 'maybe', 11: 'mfirst', 12: 'no', 24: 'msecond' };
  assert.deepEqual(parseDay(hours), {
    off: ['11:00-12:00'],
    maybe: ['09:00-10:30', '23:30-24:00'],
  });
});

test('невідомий статус або неповна доба — помилка, а не тихий пропуск', () => {
  assert.throws(() => parseDay({ ...allHours('yes'), 5: 'off' }), /години 5/);
  const { 24: _, ...partial } = allHours('yes');
  assert.throws(() => parseDay(partial), /години 24/);
});

test('відсутня черга або порожній fact.data — помилка', () => {
  assert.throws(() => buildSchedule(fact, 'GPV9.9'), /GPV9\.9/);
  assert.throws(() => buildSchedule({ data: [], update: '' }, 'GPV5.1'), /порожній/);
});

test('нова версія ДТЕК без змін для черги не вважається зміною', () => {
  const current = { ...buildSchedule(fact, 'GPV5.1'), checked_at: '2026-10-08T20:50:00+03:00' };
  const sameIntervals = { ...buildSchedule(fact, 'GPV5.1'), source_update: '08.10.2026 21:15' };
  assert.ok(sameSchedule(current, sameIntervals));

  const changed = structuredClone(sameIntervals);
  changed.days[1].off = ['14:30-19:00'];
  assert.ok(!sameSchedule(current, changed));
});

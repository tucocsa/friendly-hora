// Забирає DisconSchedule.fact зі сторінки ДТЕК і перезаписує schedule.json, якщо змінилися інтервали черги.
// Про нові чи змінені дні надсилає повідомлення в Telegram.
// Якщо дані отримати або повідомлення надіслати не вдалося, завершується з помилкою й файл не чіпає.

import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { formatMessage } from './message.js';
import { buildSchedule, changedDates, kyivIso, sameSchedule, TIME_ZONE } from './schedule.js';
import { sendTelegram } from './telegram.js';

const PAGE_URL = 'https://www.dtek-krem.com.ua/ua/shutdowns';
const SCHEDULE_FILE = new URL('../schedule.json', import.meta.url);
const GROUP = process.env.DTEK_GROUP || 'GPV5.1';

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SCHEDULE_TIMEOUT_MS = 20_000;

// Headless Chromium підписується як HeadlessChrome, а такий User-Agent WAF відсікає.
function userAgent(browserVersion) {
  const platform = {
    darwin: 'Macintosh; Intel Mac OS X 10_15_7',
    win32: 'Windows NT 10.0; Win64; x64',
  }[process.platform] ?? 'X11; Linux x86_64';
  const major = browserVersion.split('.')[0];
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

async function fetchFact() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      locale: 'uk-UA',
      timezoneId: TIME_ZONE,
      userAgent: userAgent(browser.version()),
    });
    const response = await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });

    try {
      await page.waitForFunction(
        () => typeof DisconSchedule === 'object' && DisconSchedule?.fact?.data,
        null,
        { timeout: SCHEDULE_TIMEOUT_MS },
      );
    } catch (error) {
      // Найчастіше замість сторінки прийшла заглушка WAF: показати, що саме.
      // Заглушка Imperva — iframe без тексту, тому потрібен HTML, а не innerText.
      const html = await page.content().catch(() => '');
      throw new Error(
        `DisconSchedule не з'явився. HTTP ${response?.status()} ${page.url()} html=${JSON.stringify(html.slice(0, 600))}`,
        { cause: error },
      );
    }

    return await page.evaluate(() => DisconSchedule.fact);
  } finally {
    await browser.close();
  }
}

async function fetchFactWithRetries() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchFact();
    } catch (error) {
      if (attempt === ATTEMPTS) throw error;
      console.warn(`Спроба ${attempt}/${ATTEMPTS} не вдалася: ${error.message}`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function readSchedule() {
  try {
    return JSON.parse(await readFile(SCHEDULE_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const next = buildSchedule(await fetchFactWithRetries(), GROUP);
const current = await readSchedule();

if (current && sameSchedule(current, next)) {
  console.log(`${GROUP}: без змін (версія ДТЕК ${next.source_update})`);
} else {
  const changed = changedDates(current, next);
  if (changed.length > 0) {
    const text = formatMessage(next, changed);
    console.log(`${GROUP}: графік змінився (версія ДТЕК ${next.source_update})\n\n${text}`);
    // Спершу повідомлення, потім файл: якщо Telegram не відповів, наступний запуск спробує ще раз.
    await sendTelegram(text);
  } else {
    console.log(`${GROUP}: прибрано минулі дні, інтервали не змінилися`);
  }

  const { group, source_update, days } = next;
  const schedule = { group, source_update, checked_at: kyivIso(new Date()), days };
  await writeFile(SCHEDULE_FILE, `${JSON.stringify(schedule, null, 2)}\n`);
}

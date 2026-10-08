// Щоденна перевірка: якщо людина давно не комітила, нагадати в Telegram, поки GitHub не вимкнув розклад.
// Коміти бота не враховуються: невідомо, чи GitHub зараховує їх як активність.
// Потрібна вся історія комітів (у workflow — fetch-depth: 0).

import { execFileSync } from 'node:child_process';
import { keepaliveMessage } from './message.js';
import { kyivIso } from './schedule.js';
import { sendTelegram } from './telegram.js';

const BOT_NAME = 'github-actions[bot]';

function lastHumanCommit() {
  const log = execFileSync('git', ['log', '--format=%ct%x09%an'], { encoding: 'utf8' });
  for (const line of log.trim().split('\n')) {
    const [timestamp, author] = line.split('\t');
    if (author !== BOT_NAME) return new Date(Number(timestamp) * 1000);
  }
  throw new Error('В історії немає жодного коміту людини');
}

const lastCommit = lastHumanCommit();
const text = keepaliveMessage(lastCommit, new Date(), process.env.GITHUB_REPOSITORY);

if (text) {
  console.log(text);
  await sendTelegram(text);
} else {
  console.log(`Останній коміт людини ${kyivIso(lastCommit)}, нагадування не потрібне`);
}

// Надсилає текст у чат TELEGRAM_CHAT_ID від бота TELEGRAM_BOT_TOKEN.
// Без токена чи чату — помилка, а не попередження: інакше зміна графіка тихо губиться,
// бо schedule.json оновлюється, а повідомлення так і не йде.
export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID не задано: повідомлення не надіслано, schedule.json не оновлено');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error(`Telegram sendMessage: HTTP ${response.status} ${await response.text()}`);
}

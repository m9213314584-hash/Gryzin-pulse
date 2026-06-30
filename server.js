require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// --- Конфигурация из переменных окружения ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// --- Google Sheets ---
async function appendToSheet(entry) {
  const jwt = new JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, jwt);
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];

  // Если в таблице ещё нет заголовков — создадим их
  try {
    await sheet.loadHeaderRow();
  } catch (e) {
    await sheet.setHeaderRow(['Дата', 'Время', 'Кто', 'Систолическое', 'Диастолическое', 'Пульс']);
  }

  await sheet.addRow({
    'Дата': entry.date,
    'Время': entry.time,
    'Кто': entry.who,
    'Систолическое': entry.systolic,
    'Диастолическое': entry.diastolic,
    'Пульс': entry.pulse,
  });
}

// --- Telegram ---
function buildMessage(entry) {
  let warning = '';
  if (entry.systolic >= 180 || entry.diastolic >= 110) {
    warning = '\n⚠️ Очень высокое давление! Рекомендуем обратиться к врачу.';
  } else if (entry.systolic < 90 || entry.diastolic < 60) {
    warning = '\n⚠️ Низкое давление, будьте внимательны.';
  }

  return (
    `🩺 Новое измерение давления\n\n` +
    `Кто: ${entry.who}\n` +
    `Дата: ${entry.date}, ${entry.time}\n` +
    `Давление: ${entry.systolic}/${entry.diastolic} мм рт.ст.\n` +
    `Пульс: ${entry.pulse} уд/мин` +
    warning
  );
}

async function sendTelegramMessages(entry) {
  const text = buildMessage(entry);
  const results = await Promise.allSettled(
    CHAT_IDS.map(chatId =>
      fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).then(r => r.json())
    )
  );
  return results;
}

// --- API эндпоинт ---
app.post('/api/measurement', async (req, res) => {
  try {
    const { who, systolic, diastolic, pulse } = req.body;

    if (!who || !systolic || !diastolic || !pulse) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    const now = new Date();
    const date = now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Amsterdam' });
    const time = now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

    const entry = {
      who,
      systolic: Number(systolic),
      diastolic: Number(diastolic),
      pulse: Number(pulse),
      date,
      time,
    };

    await appendToSheet(entry);
    await sendTelegramMessages(entry);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка при сохранении измерения:', err);
    res.status(500).json({ error: 'Не удалось сохранить измерение. Попробуйте ещё раз.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

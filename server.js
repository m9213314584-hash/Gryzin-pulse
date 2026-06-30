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

// Иногда ключ из Variables приходит с экранированными кавычками или без реальных переносов строк —
// нормализуем по возможности, чтобы избежать ошибки OpenSSL "DECODER routines::unsupported".
function normalizePrivateKey(raw) {
  let key = (raw || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n');
  return key;
}

// Самый надёжный способ передать ключ через Variables — закодировать его в base64 одной строкой,
// без переносов строк, чтобы исключить потерю/обрезание текста при копировании.
function resolvePrivateKey() {
  if (process.env.GOOGLE_PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64.trim(), 'base64').toString('utf8');
  }
  return normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
}

const GOOGLE_PRIVATE_KEY = resolvePrivateKey();

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
    await sheet.setHeaderRow(['Дата', 'Время суток', 'Время', 'Кто', 'Систолическое', 'Диастолическое', 'Пульс']);
  }

  await sheet.addRow({
    'Дата': entry.date,
    'Время суток': entry.timeOfDay,
    'Время': entry.time,
    'Кто': entry.who,
    'Систолическое': entry.systolic,
    'Диастолическое': entry.diastolic,
    'Пульс': entry.pulse,
  });
}

// --- Telegram ---
function personWarning(p) {
  if (p.systolic >= 180 || p.diastolic >= 110) {
    return `\n⚠️ ${p.who}: очень высокое давление! Рекомендуем обратиться к врачу.`;
  } else if (p.systolic < 90 || p.diastolic < 60) {
    return `\n⚠️ ${p.who}: низкое давление, будьте внимательны.`;
  }
  return '';
}

function buildMessage(date, time, timeOfDay, people) {
  const lines = people.map(p =>
    `${p.who}: ${p.systolic}/${p.diastolic} мм рт.ст., пульс ${p.pulse} уд/мин`
  ).join('\n');

  const warnings = people.map(personWarning).join('');

  return (
    `🩺 Новое измерение давления (${timeOfDay})\n\n` +
    `Дата: ${date}, ${time}\n\n` +
    lines +
    warnings
  );
}

async function sendTelegramMessages(date, time, timeOfDay, people) {
  const text = buildMessage(date, time, timeOfDay, people);
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
    const { timeOfDay, people } = req.body;

    if (!timeOfDay || !Array.isArray(people) || people.length !== 2) {
      return res.status(400).json({ error: 'Заполните все поля для обоих' });
    }

    for (const p of people) {
      if (!p.who || !p.systolic || !p.diastolic || !p.pulse) {
        return res.status(400).json({ error: `Заполните все поля для ${p.who || 'каждого'}` });
      }
    }

    const now = new Date();
    const date = now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Amsterdam' });
    const time = now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

    const normalizedPeople = people.map(p => ({
      who: p.who,
      systolic: Number(p.systolic),
      diastolic: Number(p.diastolic),
      pulse: Number(p.pulse),
    }));

    for (const p of normalizedPeople) {
      await appendToSheet({ ...p, date, timeOfDay, time });
    }

    await sendTelegramMessages(date, time, timeOfDay, normalizedPeople);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка при сохранении измерения:', err);
    res.status(500).json({ error: 'Не удалось сохранить измерение. Попробуйте ещё раз.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/debug-key', (req, res) => {
  const key = GOOGLE_PRIVATE_KEY;
  res.json({
    length: key.length,
    startsCorrect: key.startsWith('-----BEGIN PRIVATE KEY-----'),
    endsCorrect: key.trim().endsWith('-----END PRIVATE KEY-----'),
    lineCount: key.split('\n').length,
    hasLiteralBackslashN: key.includes('\\n'),
    first40: key.slice(0, 40),
    last40: key.slice(-40),
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});require('dotenv').config();
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

// Иногда ключ из Variables приходит с экранированными кавычками или без реальных переносов строк —
// нормализуем по возможности, чтобы избежать ошибки OpenSSL "DECODER routines::unsupported".
function normalizePrivateKey(raw) {
  let key = (raw || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n');
  return key;
}

const GOOGLE_PRIVATE_KEY = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

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
    await sheet.setHeaderRow(['Дата', 'Время суток', 'Время', 'Кто', 'Систолическое', 'Диастолическое', 'Пульс']);
  }

  await sheet.addRow({
    'Дата': entry.date,
    'Время суток': entry.timeOfDay,
    'Время': entry.time,
    'Кто': entry.who,
    'Систолическое': entry.systolic,
    'Диастолическое': entry.diastolic,
    'Пульс': entry.pulse,
  });
}

// --- Telegram ---
function personWarning(p) {
  if (p.systolic >= 180 || p.diastolic >= 110) {
    return `\n⚠️ ${p.who}: очень высокое давление! Рекомендуем обратиться к врачу.`;
  } else if (p.systolic < 90 || p.diastolic < 60) {
    return `\n⚠️ ${p.who}: низкое давление, будьте внимательны.`;
  }
  return '';
}

function buildMessage(date, time, timeOfDay, people) {
  const lines = people.map(p =>
    `${p.who}: ${p.systolic}/${p.diastolic} мм рт.ст., пульс ${p.pulse} уд/мин`
  ).join('\n');

  const warnings = people.map(personWarning).join('');

  return (
    `🩺 Новое измерение давления (${timeOfDay})\n\n` +
    `Дата: ${date}, ${time}\n\n` +
    lines +
    warnings
  );
}

async function sendTelegramMessages(date, time, timeOfDay, people) {
  const text = buildMessage(date, time, timeOfDay, people);
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
    const { timeOfDay, people } = req.body;

    if (!timeOfDay || !Array.isArray(people) || people.length !== 2) {
      return res.status(400).json({ error: 'Заполните все поля для обоих' });
    }

    for (const p of people) {
      if (!p.who || !p.systolic || !p.diastolic || !p.pulse) {
        return res.status(400).json({ error: `Заполните все поля для ${p.who || 'каждого'}` });
      }
    }

    const now = new Date();
    const date = now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Amsterdam' });
    const time = now.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

    const normalizedPeople = people.map(p => ({
      who: p.who,
      systolic: Number(p.systolic),
      diastolic: Number(p.diastolic),
      pulse: Number(p.pulse),
    }));

    for (const p of normalizedPeople) {
      await appendToSheet({ ...p, date, timeOfDay, time });
    }

    await sendTelegramMessages(date, time, timeOfDay, normalizedPeople);

    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка при сохранении измерения:', err);
    res.status(500).json({ error: 'Не удалось сохранить измерение. Попробуйте ещё раз.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/debug-key', (req, res) => {
  const key = GOOGLE_PRIVATE_KEY;
  res.json({
    length: key.length,
    startsCorrect: key.startsWith('-----BEGIN PRIVATE KEY-----'),
    endsCorrect: key.trim().endsWith('-----END PRIVATE KEY-----'),
    lineCount: key.split('\n').length,
    hasLiteralBackslashN: key.includes('\\n'),
    first40: key.slice(0, 40),
    last40: key.slice(-40),
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

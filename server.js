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

// --- Конфигурация (зашита в код, как в проекте SendMax) ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1pNX6lvh6KQVsy35xOzvErwnuIxpDIYBkdLUplVnOaLo';
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || 'gryzin-pulse@gryzin-pulse.iam.gserviceaccount.com';
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDlzNrMg9CQXccJ\nUDGQJo/temv0QfVfo747abUj8/X9x1jU99J1rUS8+LJe82KJczdwVomOX5kGeOJh\nQ8OOSnSs2IsX61hNU6MVkSSXVMPzhGzBlvDVAl3QEbN3JEyffCcMstVjznjTy7rC\nx3EzTfWJJiuCZG4RYhzKRWTMLWiqBcM/d4ITRstsLM2rZlXbUav3tdM0WemSGvRN\nI9qEQn8yoqSdBMdXNfpdWnt1jaVbXoMbT2D9RcHOis2FmJk1GKgXkF3AVgYjMcog\nGx36PWq55+4ReIl0xFg1TNOAFWOlvTALic2N2Mi42fQLodu326ccmRkrdQDm8p/T\n9T8qKZ/tAgMBAAECggEAHkFQ41FNgdxe6qp8xApXs8AE+5U9jZh84MyjlTa3AfEf\nkHaKZoToAmtJ7Ldll0wsleVG2hBbEN+UipLF6fOClgkykvUg3Jlw5NOFukjmPacH\nPJu3XIwhttXFx59nWS4a5BCdiLTz8oqlraRdkpAmjiaQ3uuDFFXTDYyCX2FxIMU+\nl/1uM5DZoWlyuimJTb0zvXPJRvVlZOlpg41W/1aQRcFDVulakhs8uoty5IaC9r+n\n0ThetuHEtX7TAFt7/Y2XwyifBoE1ucZJIKaDo/NFNveM6u/SroGHhtkB7zT/S3tB\nfK2NsFxXUckBpd8WYHl6YyBEeDoQu7/ABXejCoArAQKBgQDyxyAF7gYbmuNXpFSZ\nLAuf++2Jrx3/PeaCVaOhzYXHEIZblm1/Wq4rpgQJaY6o0D/oxnWBypX2evwDqO7P\neVjUrFJN+aWj904xdkbZU1XzlzAeWhVEJhl462I7lDIpSay3v2lYwWpRPgSDbc+u\nuctHzjvcOb7WuL/SvAf7m9rVbQKBgQDyUMrGAcRSphJRHa8lx4Nb0YwvghlLvQRL\nXks7JDMYhM3DXHZkvKxk95DpDOsq98d2c0k41fTU4wlhpM/BEaOSTXVFOKfrwy+3\nIq6fz7d4fkx40N3M+XOVNWYvxsYIk1JSSw630tqewgt4J/QUh0XqEMQ7SGslx7T7\nMV0G96vkgQKBgFBBtXtgWVKM3HTflTvhjKJBpR/r7Q2wx9/0MZjOmVfaRaBHVUFR\nl9xEEHeQFqIF3eq0mKnkb7jApUkMco3RvqTnpnmyeqh+m7HMONWlL/fL1hNikj8q\nHSeVIK8zaXWurlM8CrZVkjDzQIi2J37KWsINEkrWKBlRj9A5aqYpuqjtAoGBAKiA\nQBFjBydF7rTThIkr7Q97bxVWTcraHNNgNcZhjNp+9yrj8Dxq6yKm+PDml93gQab/\n0iogtkkXu91Xo1SptGo3TNYe6L5Mk7CxAGeHJRk4EmttKt+vk41tfaq5edpav8MU\nCJ8RlA8T9q/OcK+ZxadXk216FXBHKHYIxJzku3aBAoGAfPXn4F8b3iIDkuQLm10C\niGDFeDp1aO5ulVriZxw6tx1gQ+qIF7bS576iEyks+wcQ2PM1SpTFQVABwGqXIvX4\nniiRbyUOPN0/oACDuwD93DWeoqm4g3lmhYiqJupxd/5bSNGlpGgvpY/2tPvoEtd7\nL0h/X5vkr+6WEB1dlCxy17w=\n-----END PRIVATE KEY-----\n").replace(/\\n/g, '\n');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8744433294:AAF5wZlAwVcw1Gj2KUDxj-pMbeqdH3pvyDI';
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || '64796,69173782')
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

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

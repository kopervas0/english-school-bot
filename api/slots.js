// Vercel Serverless Function
// Отдаёт свободные слоты на пробный урок и принимает запись.
// Хранит занятые слоты в Upstash Redis — это общее хранилище, доступное
// всем инстансам функции (в отличие от обычной переменной в памяти,
// которая не переживает холодный старт и не шарится между вызовами).
//
// Нужно один раз подключить базу в проекте:
// Vercel Dashboard → Storage → Upstash → Create → Connect to Project.
// После этого нужные переменные окружения подставляются автоматически,
// руками их вводить не нужно — Redis.fromEnv() подхватывает их сам.

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const SLOT_TIMES = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30"]; // урок 30 минут, последний заканчивается в 13:00
const DAYS_AHEAD = 10; // на сколько дней вперёд открыта запись
const STORAGE_KEY = "booked-slots";

const DOW = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
const MON = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];

function workdays() {
  const out = [];
  const now = new Date();
  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const w = d.getDay();
    if (w >= 1 && w <= 5) out.push(d); // только пн-пт
  }
  return out;
}

function keyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function prettyWhen(dateStr, time) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${MON[d.getMonth()]}, ${DOW[d.getDay()]} · ${time}`;
}

async function readTaken() {
  const data = await redis.get(STORAGE_KEY);
  return data || {};
}

async function notifyTelegram(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не настроены — уведомление не отправлено');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    if (!res.ok) console.error('Telegram API ответил ошибкой:', await res.text());
  } catch (err) {
    console.error('Не удалось отправить сообщение в Telegram:', err);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const taken = await readTaken();
    const days = workdays().map((d) => {
      const k = keyOf(d);
      const free = SLOT_TIMES.filter((t) => !(taken[k] || []).includes(t));
      return { date: k, label: `${d.getDate()} ${MON[d.getMonth()]}`, dow: DOW[d.getDay()], free };
    });
    return res.status(200).json({ days });
  }

  if (req.method === 'POST') {
    const { date, time, name, contact, level } = req.body || {};
    if (!date || !time || !name || !contact) {
      return res.status(400).json({ error: 'Не хватает данных: нужны date, time, name и contact' });
    }
    if (!SLOT_TIMES.includes(time)) {
      return res.status(400).json({ error: 'Такого времени нет в расписании' });
    }

    const taken = await readTaken();
    if ((taken[date] || []).includes(time)) {
      return res.status(409).json({ error: 'Это время уже заняли — выберите другое' });
    }

    taken[date] = [...(taken[date] || []), time];
    await redis.set(STORAGE_KEY, taken);

    const when = prettyWhen(date, time);
    const text =
      '📅 Новая запись на пробный урок (из чата)\n\n' +
      `Когда: ${when}\n` +
      `Имя: ${name.trim()}\n` +
      `Контакт: ${contact.trim()}` +
      (level ? `\nУровень (по мнению ассистента): ${level}` : '');
    await notifyTelegram(text);

    return res.status(200).json({ ok: true, when });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

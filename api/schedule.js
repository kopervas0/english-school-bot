// Vercel Serverless Function — расписание и запись на занятия.
//
// Хранилище: Vercel KV (Upstash Redis REST API). Переменные окружения
// KV_REST_API_URL и KV_REST_API_TOKEN добавляются автоматически, когда вы
// подключаете KV-базу к проекту в Vercel (Storage → Create Database → KV →
// Connect Project). Без них функция продолжает работать, но брони не
// сохраняются между запросами (демо-режим) — см. README.

const MAX_DAYS_AHEAD = 10;
const MIN_NOTICE_MINUTES = 60; // не даём записаться на слот меньше чем за час

// Еженедельный шаблон доступных слотов по дню недели (0 = воскресенье)
const WEEKDAY_TEMPLATE = {
  0: ['13:00'],
  1: ['10:00', '19:00'],
  2: ['09:00'],
  3: ['11:00', '20:00'],
  4: ['18:00'],
  5: ['10:00'],
  6: ['12:00', '15:00'],
};

const WEEKDAY_LABELS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function pad(n) { return String(n).padStart(2, '0'); }

function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildDays() {
  const days = [];
  const now = new Date();
  for (let i = 0; i < MAX_DAYS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const weekday = d.getDay();
    days.push({
      date: dateStr(d),
      weekday,
      weekdayLabel: WEEKDAY_LABELS_RU[weekday],
      dayLabel: `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`,
      times: WEEKDAY_TEMPLATE[weekday] || [],
    });
  }
  return days;
}

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.result == null) return null;
    try { return JSON.parse(data.result); } catch { return null; }
  } catch (err) {
    console.error('KV get failed:', err);
    return null;
  }
}

async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return false;
  try {
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    return res.ok;
  } catch (err) {
    console.error('KV set failed:', err);
    return false;
  }
}

async function sendBookingToTelegram({ date, time, name, contact }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.warn('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не настроены — уведомление о записи не отправлено');
    return;
  }
  const text =
    '📅 Новая запись на занятие\n\n' +
    `Дата: ${date}\n` +
    `Время: ${time}\n` +
    `Имя: ${name.trim()}\n` +
    `Контакт: ${contact.trim()}`;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('Не удалось отправить уведомление о записи в Telegram:', err);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const days = buildDays();
    const booked = (await kvGet('bookings')) || {};
    const now = new Date();

    const result = days.map((d, idx) => {
      let times = d.times.filter((t) => !(booked[d.date] || []).includes(t));
      if (idx === 0) {
        // сегодня — прячем слоты, до которых осталось меньше часа
        times = times.filter((t) => {
          const [hh, mm] = t.split(':').map(Number);
          const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
          return slot.getTime() - now.getTime() > MIN_NOTICE_MINUTES * 60 * 1000;
        });
      }
      return { date: d.date, weekday: d.weekdayLabel, label: d.dayLabel, times };
    });

    return res.status(200).json({ days: result });
  }

  if (req.method === 'POST') {
    const { date, time, name, contact } = req.body || {};
    if (!date || !time || !name || !contact) {
      return res.status(400).json({ error: 'Заполните дату, время, имя и контакт' });
    }

    const days = buildDays();
    const dayEntry = days.find((d) => d.date === date);
    if (!dayEntry) {
      return res.status(400).json({ error: 'Дата вне доступного окна записи (10 дней)' });
    }
    if (!dayEntry.times.includes(time)) {
      return res.status(400).json({ error: 'Такого времени нет в расписании на этот день' });
    }

    const booked = (await kvGet('bookings')) || {};
    if ((booked[date] || []).includes(time)) {
      return res.status(409).json({ error: 'Это время уже занято, выберите другое' });
    }

    booked[date] = [...(booked[date] || []), time];
    const persisted = await kvSet('bookings', booked);
    if (!persisted) {
      console.warn('KV не настроен — бронь подтверждена пользователю, но не сохранена между запросами');
    }

    await sendBookingToTelegram({ date, time, name, contact });

    return res.status(200).json({ success: true, persisted });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

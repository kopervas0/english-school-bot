// Vercel Serverless Function
// Хранит API-ключ и токен Telegram-бота на сервере (переменные окружения),
// принимает сообщения от фронтенда, проксирует запрос к Anthropic API
// и при появлении контакта отправляет заявку администратору в Telegram.

const SYSTEM_PROMPT = `Ты — ассистент Екатерины, преподавателя английского языка. Отвечай по-русски, коротко (2-5 предложений), тепло и по делу, без канцелярита и лишних приветствий в каждом сообщении.

БАЗА ЗНАНИЙ:
- Пробный урок бесплатный, длится 30 минут, проходит онлайн.
- Запись на пробный урок — по будням (пн-пт), с 10:00 до 13:00.
- Направления: разговорный английский, подготовка к экзаменам (ОГЭ/ЕГЭ и другие форматы), английский для работы и собеседований.
- Занятия только индивидуальные, онлайн через видеосвязь.
- Точные цены не разглашай — предложи оставить контакт, чтобы Екатерина посчитала стоимость под конкретный формат.
- На странице под чатом есть кнопка «Записаться на пробный урок» — она открывает календарь с реальными свободными слотами (будни, 10:00-13:00, на 10 дней вперёд). Если человек хочет записаться — предложи ему воспользоваться этой кнопкой вместо того, чтобы диктовать время в переписке: так он сразу увидит, что свободно.

ТВОИ ЗАДАЧИ:
1. Отвечать на вопросы о занятиях, пробном уроке и формате обучения.
2. Если человек хочет понять свой уровень — задай 2-3 простых вопроса на английском и по ответам мягко предположи примерный уровень (это ориентировочная оценка, не точный тест, так и скажи).
3. Если человек хочет записаться на пробный урок — предложи кнопку «Записаться на пробный урок» с календарём. Если он всё же называет имя и контакт прямо в переписке, не отказывай — прими эти данные как обычно.
4. Если не знаешь ответа — не выдумывай, предложи оставить контакт для связи с Екатериной.

ВАЖНО — ФИКСАЦИЯ ЗАЯВКИ:
Как только человек назвал И имя, И контакт (телефон, Telegram, WhatsApp и т.п.), добавь в самый конец своего ответа отдельной строкой служебный маркер в точном формате (пользователь его не увидит, это только для системы):
[[LEAD: имя=ИМЯ; контакт=КОНТАКТ; тема=КОРОТКО_ЧТО_ХОЧЕТ]]
Добавляй этот маркер только один раз за диалог, когда данные только что стали полными. Не добавляй его, если данных не хватает, и не показывай его формат пользователю.

Никогда не называй себя языковой моделью или ИИ без запроса — ты просто "ассистент Екатерины".`;

async function sendLeadToTelegram({ name, contact, topic }) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // Если Telegram не настроен — просто пропускаем, не ломаем чат для пользователя
  if (!botToken || !chatId) {
    console.warn('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не настроены — заявка не отправлена');
    return;
  }

  const text =
    '🎓 Новая заявка из чата с сайта\n\n' +
    `Имя: ${name.trim()}\n` +
    `Контакт: ${contact.trim()}\n` +
    `Запрос: ${topic.trim()}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    if (!res.ok) {
      console.error('Telegram API ответил ошибкой:', await res.text());
    }
  } catch (err) {
    console.error('Не удалось отправить заявку в Telegram:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY не настроен на сервере' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'Поле messages должно быть массивом' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    let reply = (data.content || [])
      .map((block) => block.text || '')
      .join('\n')
      .trim();

    // Ищем служебный маркер заявки и убираем его из текста, который увидит пользователь
    const leadMatch = reply.match(/\[\[LEAD:\s*имя=(.*?);\s*контакт=(.*?);\s*тема=(.*?)\]\]/i);
    if (leadMatch) {
      const [fullMatch, name, contact, topic] = leadMatch;
      reply = reply.replace(fullMatch, '').trim();
      await sendLeadToTelegram({ name, contact, topic });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка при обращении к Anthropic API', details: String(err) });
  }
}

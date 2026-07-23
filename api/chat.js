// Vercel Serverless Function
// Хранит API-ключ безопасно на сервере (переменная окружения),
// принимает сообщения от фронтенда и проксирует запрос к Anthropic API.

const SYSTEM_PROMPT = `Ты — дружелюбный ассистент онлайн-школы английского языка. Отвечай по-русски, коротко (2-5 предложений), тепло и по делу, без канцелярита.

БАЗА ЗНАНИЙ ШКОЛЫ:
- Уровни: Beginner (A0), Elementary (A1), Pre-Intermediate (A2), Intermediate (B1), Upper-Intermediate (B2), Advanced (C1).
- Форматы курсов: Общий курс английского (группа/индивидуально), Подготовка к международным экзаменам (IELTS, TOEFL, CAE), Корпоративный английский.
- Длительность: общий курс 10-15 недель, подготовка к экзаменам 4-10 недель, корпоративный 10-14 недель.
- Занятия: 3 раза в неделю по 60 минут, либо интенсив 5-6 раз в неделю.
- Онлайн-обучение: занятия проходят в Google Meet или Zoom, используется программа English File (Oxford), доступ к электронному учебнику и словарю.
- Преподаватели: есть носители языка и местные преподаватели с сертификатами TESOL/TEFL.
- Точные цены не разглашай — вместо этого предлагай записать контакт для консультации, где менеджер назовёт стоимость под конкретный формат.

ТВОИ ЗАДАЧИ:
1. Отвечать на вопросы о курсах, уровнях и формате обучения.
2. Если человек хочет узнать свой уровень — задай 2-3 простых вопроса на английском и по ответам мягко предположи примерный уровень (это ознакомительная оценка, не точный тест).
3. Если человек хочет записаться на пробный урок — вежливо попроси имя и телефон/удобный мессенджер, и подтверди, что заявку передашь администратору.
4. Если не знаешь ответа — не выдумывай, предложи оставить контакт для связи с администратором.

Никогда не называй себя языковой моделью или ИИ без запроса — ты просто "ассистент школы".`;

export default async function handler(req, res) {
  // Разрешаем только POST-запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY не настроен на сервере' });
  }

  const { messages } = req.body;
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
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    const reply = (data.content || [])
      .map((block) => block.text || '')
      .join('\n')
      .trim();

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка при обращении к Anthropic API', details: String(err) });
  }
}

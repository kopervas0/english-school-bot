const log = document.getElementById('chatLog');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInput');
const sendBtn = document.getElementById('chatSend');
const errBox = document.getElementById('chatErr');
const btnBook = document.getElementById('btnBook');

const history = []; // { role: 'user'|'assistant', content: '...' }

function addMessage(text, cls) {
  const div = document.createElement('div');
  div.className = 'assistant__msg assistant__msg--' + cls;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function addTyping() {
  const div = document.createElement('div');
  div.className = 'assistant__typing';
  div.id = 'assistant-typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function removeTyping() {
  const el = document.getElementById('assistant-typing');
  if (el) el.remove();
}

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

async function sendToBot(text) {
  errBox.textContent = '';
  addMessage(text, 'user');
  history.push({ role: 'user', content: text });
  sendBtn.disabled = true;
  addTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history })
    });
    const data = await res.json();
    removeTyping();

    if (!res.ok) {
      errBox.textContent = 'Не удалось получить ответ. Попробуйте ещё раз чуть позже.';
      console.error(data.error);
    } else {
      addMessage(data.reply, 'bot');
      history.push({ role: 'assistant', content: data.reply });
    }
  } catch (err) {
    removeTyping();
    errBox.textContent = 'Проблема с соединением. Проверьте интернет и попробуйте снова.';
    console.error(err);
  } finally {
    sendBtn.disabled = false;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  await sendToBot(text);
  input.focus();
});

/* ================= КАЛЕНДАРЬ ЗАПИСИ НА ПРОБНЫЙ УРОК ================= */
let bookOpen = false;
btnBook.addEventListener('click', async () => {
  if (bookOpen) return;
  bookOpen = true;
  btnBook.disabled = true;

  const wrap = document.createElement('div');
  wrap.className = 'assistant__msg assistant__msg--widget';
  wrap.innerHTML = `<div class="assistant__widget-title">Свободное время на пробный урок</div><div class="assistant__days">Загружаем расписание…</div>`;
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;

  let selected = null;

  async function loadSlots() {
    const box = wrap.querySelector('.assistant__days');
    try {
      const res = await fetch('/api/slots');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');

      box.innerHTML = data.days.map(d => `
        <div class="assistant__day">
          <div class="assistant__day-head"><span class="assistant__day-date">${d.label}</span><span class="assistant__day-dow">${d.dow}</span></div>
          ${d.free.length
            ? `<div class="assistant__slots">${d.free.map(t => `<button type="button" class="assistant__slot" data-date="${d.date}" data-time="${t}" aria-pressed="false">${t}</button>`).join('')}</div>`
            : `<div class="assistant__day-empty">всё занято</div>`}
        </div>
      `).join('');

      box.querySelectorAll('.assistant__slot').forEach(btn => {
        btn.addEventListener('click', () => {
          box.querySelectorAll('.assistant__slot').forEach(b => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
          selected = { date: btn.dataset.date, time: btn.dataset.time };
          wrap.querySelector('.assistant__book-form').classList.add('show');
        });
      });
    } catch (e) {
      box.innerHTML = `<div class="assistant__day-empty">Не удалось загрузить расписание. Попробуйте обновить страницу.</div>`;
      console.error(e);
    }
  }

  wrap.insertAdjacentHTML('beforeend', `
    <div class="assistant__book-form">
      <div class="assistant__book-row">
        <input type="text" id="bk-name" placeholder="Имя">
        <input type="text" id="bk-contact" placeholder="Телефон или Telegram">
      </div>
      <button type="button" id="bk-submit" class="btn btn--primary btn--small">Записаться на выбранное время</button>
      <div class="assistant__book-status" id="bk-status"></div>
    </div>
  `);

  await loadSlots();

  wrap.querySelector('#bk-submit').addEventListener('click', async () => {
    const status = wrap.querySelector('#bk-status');
    const name = wrap.querySelector('#bk-name').value.trim();
    const contact = wrap.querySelector('#bk-contact').value.trim();

    if (!selected) { status.textContent = 'Сначала выберите время.'; status.className = 'assistant__book-status assistant__book-status--bad'; return; }
    if (!name || !contact) { status.textContent = 'Укажите имя и контакт.'; status.className = 'assistant__book-status assistant__book-status--bad'; return; }

    status.textContent = 'Записываем…'; status.className = 'assistant__book-status';
    try {
      const res = await fetch('/api/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selected.date, time: selected.time, name, contact })
      });
      const data = await res.json();

      if (res.status === 409) {
        status.textContent = 'Это время только что заняли — выберите другое.'; status.className = 'assistant__book-status assistant__book-status--bad';
        selected = null;
        await loadSlots();
        return;
      }
      if (!res.ok) {
        status.textContent = data.error || 'Не удалось записаться, попробуйте ещё раз.'; status.className = 'assistant__book-status assistant__book-status--bad';
        return;
      }

      status.textContent = `Готово! Записаны на ${data.when}.`; status.className = 'assistant__book-status assistant__book-status--ok';
      wrap.querySelectorAll('.assistant__slot, input, #bk-submit').forEach(el => el.disabled = true);
      addMessage(`Записал(а) вас на пробный урок: ${data.when}. Напишу вам заранее.`, 'bot');
    } catch (e) {
      status.textContent = 'Проблема с соединением, попробуйте ещё раз.'; status.className = 'assistant__book-status assistant__book-status--bad';
      console.error(e);
    }
  });
});

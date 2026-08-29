import type { Express } from "express";

/**
 * Public legal pages required by the Google OAuth consent screen (privacy
 * policy and terms of service must be live URLs on the authorized domain).
 * Served straight from the server so they exist regardless of the SPA build
 * and never fall behind the auth gate.
 */

const PAGE_STYLE = `
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 720px;
         margin: 0 auto; padding: 2rem 1.25rem 4rem; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  p, li { font-size: .95rem; } .muted { color: #666; font-size: .85rem; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #eee; } .muted { color: #999; } }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — RadioFlow</title><style>${PAGE_STYLE}</style></head>
<body><h1>${title}</h1>${body}
<p class="muted">RadioFlow · вопросы: dan.orlin77@gmail.com</p></body></html>`;
}

const PRIVACY_HTML = page("Политика конфиденциальности", `
<p class="muted">Обновлено: 29 августа 2026</p>
<p>RadioFlow — инструмент подготовки радиоэфиров: генерация сценариев, озвучка и
архивирование готовых записей. Эта страница описывает, какие данные обрабатывает
приложение и зачем.</p>

<h2>Какие данные мы обрабатываем</h2>
<ul>
  <li><b>Учётная запись:</b> e-mail и имя, указанные при регистрации.</li>
  <li><b>Контент:</b> созданные вами сценарии, настройки передач и аудиозаписи.</li>
  <li><b>Google-аккаунт (по желанию):</b> при подключении Google Диска мы получаем
      адрес почты аккаунта и доступ уровня <code>drive.file</code> — приложение видит
      и изменяет <b>только файлы и папки, созданные им самим</b>. Доступа к остальному
      содержимому вашего Диска у приложения нет.</li>
</ul>

<h2>Как используются данные Google</h2>
<ul>
  <li>Токен доступа хранится на сервере и используется исключительно для выгрузки
      готовых аудиозаписей в папку RadioFlow на вашем Диске.</li>
  <li>Данные Google не передаются третьим лицам, не продаются и не используются
      для рекламы или обучения моделей.</li>
</ul>

<h2>Удаление данных и отзыв доступа</h2>
<ul>
  <li>Отключить Google Диск можно в настройках приложения («Хранилище записей» →
      «Отключить») — сохранённый токен при этом удаляется.</li>
  <li>Отозвать доступ также можно в аккаунте Google:
      <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</li>
  <li>Для удаления учётной записи и данных напишите на адрес внизу страницы.</li>
</ul>
`);

const TERMS_HTML = page("Условия использования", `
<p class="muted">Обновлено: 29 августа 2026</p>
<ul>
  <li>RadioFlow предоставляется «как есть» для подготовки радиоконтента:
      генерации сценариев, озвучки и хранения записей.</li>
  <li>Ответственность за содержание создаваемых материалов и соблюдение прав
      третьих лиц несёт пользователь.</li>
  <li>Подключение внешних сервисов (Google Диск, Яндекс Диск) — добровольное
      и может быть отключено в настройках в любой момент.</li>
  <li>Мы можем обновлять эти условия; актуальная версия всегда доступна на этой
      странице.</li>
</ul>
`);

export function registerLegalPages(app: Express) {
  app.get("/privacy", (_req, res) => res.type("html").send(PRIVACY_HTML));
  app.get("/terms", (_req, res) => res.type("html").send(TERMS_HTML));
}

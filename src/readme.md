# Obrazm — фронтенд‑сборка на Gulp

> Этот README — краткий и понятный хэнд‑офф для разработчика. Он покрывает структуру проекта, команды, пайплайны сборки (код, медиа, фавиконки, видео), инкрементальную обработку и публикацию на GitHub Pages.

---

## 1) Быстрый старт

**Требования**
- Node.js ≥ 18 (рекомендуется LTS).  
- macOS/Windows/Linux, терминал с `npm`.

**Установка**
```bash
npm ci     # или: npm install
npm run check:env  # быстрая проверка версии Node, Gulp CLI и svgo
```

**Основные команды**
```jsonc
// package.json → scripts
{
  "dev": "gulp dev",        // полная одноразовая сборка: dist → build
  "build": "gulp build",    // собрать только продакшн (build)
  "build:dist": "gulp build:dist", // собрать только dist
  "check:env": "node -e \"console.log(process.version)\" && npx gulp -v && npx svgo -v || true"
}
```

**Запуск**
```bash
npm run dev
# Доп. флаги для ускорения (важно: флаги идут после двойного дефиса --):
npm run dev -- --skip-media        # пропустить все медиа (images/icons/video)
npm run dev -- --skip-video        # собрать картинки/иконки, пропустить видео
npm run dev -- --only-media        # собрать только медиа
npm run dev -- --no-clean          # не очищать dist/ и build/ перед сборкой
```

---

## 2) Структура проекта

```
obrazm/
├─ src/                    # исходники
│  ├─ *.html               # страницы (используют @@include)
│  ├─ partials/            # html‑модули (head, header, footer, блоки)
│  │  └─ global/           # общие парциалы
│  ├─ css/                 # SCSS (общие и страничные файлы)
│  ├─ js/                  # JavaScript
│  └─ assets/
│     ├─ images/           # изображения (вложенность сохраняется)
│     ├─ icons/            # svg/png иконки (не favicon‑набор)
│     ├─ favicons/         # favicon.svg, png‑варианты, manifest.json
│     └─ video/            # видео (mp4)
│
├─ dist/                   # «читаемая» сборка (без минификации, с sourcemaps)
├─ build/                  # продакшн (минифицированный код, медиа из dist, .nojekyll)
├─ gulpfile.js             # задачи Gulp
├─ package.json            # зависимости и скрипты
└─ site.json               # данные сайта (адреса, соцсети и т. п.)
```

---

## 3) Как работает сборка

### HTML
- Сборка страниц через **gulp‑file‑include** (`@@include`).
- В инклюды подмешивается объект `SITE` из `src/site.json`. Можно использовать плейсхолдеры вида `@@SITE.address`, `@@SITE.social.telegram` и т.д.
- В `build/` HTML минифицируется.

**Пример include из корневой страницы**
```html
@@include('./partials/global/head.html', {
  page: {
    title: 'Заголовок страницы',
    description: 'Описание страницы',
    keywords: 'ключевые, слова'
  },
  SITE: @@SITE
})
```
> Путь в `@@include` считается **от файла, где он вызван** (в gulpfile стоит `basepath: '@file'`).

### CSS (SCSS → CSS)
- Компиляция `sass` → автопрефиксы → группировка media‑запросов → sourcemaps в `dist/`.
- В `build/` — минификация через `cssnano`.
- Поддерживаются **множественные входы**: любой `src/css/*.scss` даст одноимённый `dist/css/*.css` (и минифицированный в `build/css/`). Это удобно для страничных стилей: `index.scss` → `index.css` и т.д.

### JS
- В `dist/` — копирование со сборкой карт sourcemaps.
- В `build/` — минификация через `terser`.
- Базовый путь выставлен так, чтобы **не** создавать лишний `js/js` во вложениях.

### Вендорные файлы
- **normalize.css**, **UIkit** → кладутся в `vendor/` (и в `dist/`, и в `build/`).
- Если добавляются ещё библиотеки (например, locomotive‑scroll), либо подключайте их из npm через свой таск vendor, либо импортируйте в свой SCSS/JS по месту.

### Изображения и иконки
- Оптимизация через **gulp‑imagemин**: mozjpeg, pngquant, svgo.
- Инкрементальная обработка: используется `gulp-newer` — уже сжатые файлы повторно не трогаются.
- Вложенность каталогов сохраняется. Результат: `dist/assets/images/**`, затем они **копируются** в `build/assets/images/**`.

### Favicons
- Если есть `src/assets/favicons/favicon.svg`, генерируются:
  - `favicon-32.png`, `favicon-16.png`, `favicon.ico`;
  - исходный `favicon.svg` копируется;
  - PNG оптимизируются (imagemin/pngquant), SVG — через svgo.
- `manifest.json` **просто копируется** (без минификации содержимого).

### Видео
- Вход: `src/assets/video/*.mp4`.
- На выходе (по умолчанию **только** масштабированные версии ~75%):
  - `*.mp4` (без звука, масштаб 75%),
  - `*.webm` (масштаб 75%),
  - постер `*.jpg` из первого кадра.
- Реализация: `fluent-ffmpeg` + `ffmpeg-static`. Пропускает уже готовые артефакты по времени модификации.

### SEO‑файлы
- Если в `src/` присутствуют `robots.txt` и/или `sitemap.xml`, они копируются в `dist/` и `build/`.

### GitHub Pages helper
- В `build/` создаётся `.nojekyll`, чтобы GitHub Pages не применял Jekyll‑обработку.

---

## 4) Инкрементальная сборка и очистка

- **Картинки/иконки** — `gulp-newer`: если версия в `dist/` актуальна, файл **пропускается**.
- **Видео** — проверка по наличию/свежести выходных файлов: уже собранные форматы и постер **пропускаются**.
- Есть задачи‑«санитайзеры» для удаления **осиротевших артефактов** (когда исходник удалён из `src`, а файл в `dist/build` остался).
- Пустые папки после операций удаляются задачами `pruneDistEmpty` и `pruneBuildEmpty`.

> Чтобы реально выигрывать время, в повседневной разработке используйте `--no-clean` (не удалять dist/build между прогонами) и/или `--skip-video`.

---

## 5) GitHub Pages (публикация)

**Вариант A — через GitHub Actions (рекомендуется)**
1. Создайте workflow (например, `.github/workflows/deploy.yml`), который делает: `npm ci`, `npm run dev`, публикует содержимое `build/` в ветку `gh-pages`.
2. В настройках репозитория включите Pages и укажите источник `gh-pages` → `/` (root).

**Вариант B — вручную**
1. Соберите проект: `npm run dev`.
2. Поместите содержимое `build/` в ветку `gh-pages` (или в папку `docs/` и настройте публикацию из `docs/`).

> При публикации под поддиректорией (например, `https://user.github.io/repo/`) используйте относительные пути или префикс `/<repo>/` в ссылках на статику.

---

## 6) Рецепты

**Добавить новую страницу**
1. Создайте `src/new-page.html`.
2. Подключите модули:
```html
@@include('./partials/global/head.html', {
  page: { title: 'Новая страница' },
  SITE: @@SITE
})
```
3. (опц.) Создайте стили `src/css/new-page.scss` — получите `dist/css/new-page.css` и минифицированный вариант в `build/`.

**Добавить фавиконки**
- Положите `src/assets/favicons/favicon.svg` и (опц.) `manifest.json`. На выходе будут `favicon-32.png`, `favicon-16.png`, `favicon.ico`, `favicon.svg`.

**Подключить библиотеку (пример: locomotive-scroll)**
```bash
npm i locomotive-scroll
```
Дальше либо импортируйте её в свой JS, либо добавьте в таск vendor/скопируйте из `node_modules` в `vendor/` (по аналогии с UIkit).

---

## 7) Частые проблемы и решения

- **ENOENT при @@include** — путь в include считается от текущего файла. Для страниц из `src/*.html` корректный путь к общим парциалам: `./partials/global/...`.
- **JSON5 ошибки в параметрах include** — не забывайте запятые. Разрешён синтаксис JSON5 (можно без кавычек у ключей).
- **Sass предупреждает про `@import`** — это deprecate‑уведомление; переходите на `@use`/`@forward` в новых файлах.
- **Сборка видео долгая** — используйте `--skip-video` при обычной разработке и прогоняйте полный конвейер только перед релизом.

---

## 8) Контакты и поддержка

Если потребуется: добавлю YAML‑workflow для GitHub Pages, пример `.env` (если появится), а также шаблоны partials.


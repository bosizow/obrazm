/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const gulp = require('gulp');
const plumber = require('gulp-plumber');
const log = require('fancy-log');
const c = require('ansi-colors');

const fileinclude = require('gulp-file-include');
const replace = require('gulp-replace');

const sass = require('gulp-sass')(require('sass'));
const postcss = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const gcmq = require('gulp-group-css-media-queries');
const sourcemaps = require('gulp-sourcemaps');

const terser = require('gulp-terser');
const htmlmin = require('gulp-htmlmin');
const rename = require('gulp-rename');

const fg = require('fast-glob');
const mergeStream = require('merge-stream');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const newer = require('gulp-newer');
const sharp = require('sharp');
const toIco = require('to-ico');
const cached = require('gulp-cached');
const remember = require('gulp-remember');
const minimist = require('minimist');

/* ───── видео: ffmpeg ───── */
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static'); // путь к встроенному бинарнику ffmpeg (если доступен)
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

/* ───────────────────────────────────────────────────────────
   Конфиг
   ─────────────────────────────────────────────────────────── */
const USE_MIN_SUFFIX = false; // ← true → *.min.css / *.min.js в build
const MAKE_75_PERCENT_VARIANTS = true; // ← можно выключить, если не нужно
const argv = minimist(process.argv.slice(2));
const SKIP_MEDIA = Boolean(argv['skip-media']);
const ONLY_MEDIA = Boolean(argv['only-media']);
const NO_CLEAN = Boolean(argv['no-clean'] || argv.preserve);
const noop = (done) => done();

const paths = {
  src: 'src',
  dist: 'dist',
  build: 'build',
  html: {
    src: 'src/*.html',
    watch: ['src/*.html', 'src/partials/**/*.html'],
    dist: 'dist',
    build: 'build',
  },
  styles: {
    src: 'src/styles/**/*.scss',
    entry: 'src/styles/main.scss',
    dist: 'dist/css',
    build: 'build/css',
  },
  scripts: {
    src: 'src/js/**/*.js',
    dist: 'dist/js',
    build: 'build/js',
  },
  vendor: {
    dist: 'dist/vendor',
    build: 'build/vendor',
    normalize: 'node_modules/normalize.css/normalize.css',
    uikitCss: 'node_modules/uikit/dist/css/uikit.min.css',
    uikitJs: [
      'node_modules/uikit/dist/js/uikit.min.js',
      'node_modules/uikit/dist/js/uikit-icons.min.js',
    ],
  },
  // Можешь держать assets здесь или вложенным в vendor.assets — ниже есть резолвер
  assets: {
    images: {
      src: 'src/assets/images/**/*.{jpg,jpeg,png,gif,svg,webp,avif}',
      dist: 'dist/assets/images',
      build: 'build/assets/images',
    },
    icons: {
      src: 'src/assets/icons/**/*.{svg,png,ico}',
      dist: 'dist/assets/icons',
      build: 'build/assets/icons',
      faviconSvg: 'src/assets/icons/favicon.svg',
      faviconIcoDist: 'dist/assets/icons/favicon.ico',
    },
    video: {
      // входные видео (по ТЗ — mp4)
      src: 'src/assets/video/**/*.mp4',
      dist: 'dist/assets/video',
      build: 'build/assets/video',
      // расширения выходных файлов
      posterExt: '.jpg', // постер из первого кадра
    },
  },
};

/* ───────────────── helpers ───────────────── */
function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
function warnMissing(what, where) {
  log(c.yellow(`⚠ ${what} не найдено в ${where}. Пропускаю задачу.`));
}
function rmDirSafe(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); log(c.gray(`clean: ${dir} removed`)); }
  catch (e) { log(c.red(`clean error for ${dir}: ${e.message}`)); }
}
function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ───────── GitHub Pages helper: .nojekyll ───────── */
function pagesNoJekyll(done) {
  try {
    const srcNoJekyll = path.join(paths.src, '.nojekyll');
    ensureDirSync(paths.build);
    if (fs.existsSync(srcNoJekyll)) {
      fs.copyFileSync(srcNoJekyll, path.join(paths.build, '.nojekyll'));
      log(c.gray('pages: copied src/.nojekyll → build/.nojekyll'));
    } else {
      fs.writeFileSync(path.join(paths.build, '.nojekyll'), '');
      log(c.gray('pages: created build/.nojekyll'));
    }
  } catch (e) {
    log(c.yellow(`pages: .nojekyll warning — ${e.message}`));
  }
  done();
}
exports.pagesNoJekyll = pagesNoJekyll;

/** stream с allowEmpty и логом при отсутствии файлов */
function srcChecked(globPattern, opts = {}) {
  const files = fg.sync(globPattern, { dot: false });
  if (!files.length) warnMissing(`Файлы по шаблону "${globPattern}"`, process.cwd());
  return gulp.src(globPattern, { allowEmpty: true, ...opts });
}
/** рекурсивно удалить пустые директории (но не сам root) */
function removeEmptyDirsRecursive(dir) {
  if (!exists(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) removeEmptyDirsRecursive(path.join(dir, e.name));
  }
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      log(c.gray(`prune: removed empty ${dir}`));
    }
  } catch { /* noop */ }
}
function pruneEmptyUnder(root) {
  if (!exists(root)) return;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory()) removeEmptyDirsRecursive(path.join(root, e.name));
  }
}
/* ───────── unlink helpers (удаляем артефакты без del) ───────── */
function rmFileSafe(p) { try { fs.rmSync(p, { force: true }); } catch { } }
function rmIfExists(p) { if (exists(p)) rmFileSafe(p); }
function deleteHtmlOutputsOnUnlink(absSrc) {
  const rel = path.relative(paths.src, absSrc); // src/index.html → index.html
  rmIfExists(path.join(paths.html.dist, rel));
  rmIfExists(path.join(paths.html.build, rel));
}
function deleteJsOutputsOnUnlink(absSrc) {
  const rel = path.relative('src/js', absSrc); // src/js/app.js → app.js
  rmIfExists(path.join(paths.scripts.dist, rel));
  rmIfExists(path.join(paths.scripts.dist, rel + '.map')); // sourcemap
  rmIfExists(path.join(paths.scripts.build, rel));
}
function deleteImageOutputsOnUnlink(absSrc) {
  const base = baseDirFromGlob(ASSETS.images.src) || 'src/assets/images';
  const rel = path.relative(base, absSrc);
  rmIfExists(path.join(ASSETS.images.dist, rel));
  rmIfExists(path.join(ASSETS.images.build, rel));
}
function deleteIconOutputsOnUnlink(absSrc) {
  const base = baseDirFromGlob(ASSETS.icons.src) || 'src/assets/icons';
  const rel = path.relative(base, absSrc);
  rmIfExists(path.join(ASSETS.icons.dist, rel));
  rmIfExists(path.join(ASSETS.icons.build, rel));
  // если удалили favicon.svg — уберём и favicon.ico
  if (ASSETS.icons.faviconSvg && path.resolve(absSrc) === path.resolve(ASSETS.icons.faviconSvg)) {
    rmIfExists(ASSETS.icons.faviconIcoDist);
    const icoBuild = path.join('build', path.relative('dist', ASSETS.icons.faviconIcoDist));
    rmIfExists(icoBuild);
  }
}
function deleteVideoOutputsOnUnlink(absSrc) {
  const base = baseDirFromGlob(ASSETS.video.src) || 'src/assets/video';
  const rel = path.relative(base, absSrc);
  // список всех ожидаемых выходов:
  const outs = expectedVideoOutputs(rel);
  for (const o of outs) {
    rmIfExists(o); // dist
    const inBuild = path.join('build', path.relative('dist', o)); // копия в build
    rmIfExists(inBuild);
  }
  // подчистим запись в манифесте
  const man = loadVideoManifest();
  if (man[rel]) { delete man[rel]; saveVideoManifest(man); }
}
/* ─────────────── Video cache & helpers ─────────────── */
const VIDEO_CACHE_FILE = '.cache/video.json';
function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
function loadVideoManifest() {
  try { return JSON.parse(fs.readFileSync(VIDEO_CACHE_FILE, 'utf8')); } catch { return {}; }
}
function saveVideoManifest(man) {
  ensureDirSync(path.dirname(VIDEO_CACHE_FILE));
  fs.writeFileSync(VIDEO_CACHE_FILE, JSON.stringify(man, null, 2));
}
// Конфиг, влияющий на результирующие файлы → часть сигнатуры
function videoSettingsId() {
  return JSON.stringify({
    mp4: { crf: 26, preset: 'medium' },
    webm: { crf: 32, bv0: true },
    scale75: MAKE_75_PERCENT_VARIANTS ? 0.75 : 0,
    posterExt: ASSETS.video && ASSETS.video.posterExt || '.jpg',
  });
}
function expectedVideoOutputs(relInput) {
  const baseNoExt = relInput.replace(/\.[^.]+$/, '');
  const outDir = path.join(ASSETS.video.dist, path.dirname(relInput));
  const posterExt = (ASSETS.video && ASSETS.video.posterExt) || '.jpg';
  const outs = [
    path.join(outDir, `${path.basename(baseNoExt)}.mp4`),
    path.join(outDir, `${path.basename(baseNoExt)}.webm`),
    path.join(outDir, `${path.basename(baseNoExt)}${posterExt}`),
  ];
  if (MAKE_75_PERCENT_VARIANTS) {
    outs.push(
      path.join(outDir, `${path.basename(baseNoExt)}-75.mp4`),
      path.join(outDir, `${path.basename(baseNoExt)}-75.webm`),
    );
  }
  return outs;
}
function outputsAreFresh(outs, srcStat) {
  try {
    return outs.length > 0 && outs.every((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= srcStat.mtimeMs);
  } catch { return false; }
}

/* ───────── helpers: unlink → очистка кэша ───────── */
function dropFromCaches(cacheName, filePathAbs) {
  try {
    if (cached.caches[cacheName]) delete cached.caches[cacheName][filePathAbs];
    remember.forget(cacheName, filePathAbs);
  } catch { /* noop */ }
}

/* ─────────────── assets-resolver ─────────────── */
function baseDirFromGlob(glob) {
  if (!glob) return '';
  const i = glob.indexOf('**');
  const raw = i >= 0 ? glob.slice(0, i) : path.dirname(glob);
  return raw.replace(/[/\\]+$/, '');
}
/** поддерживаем оба варианта размещения: paths.assets.* или paths.vendor.assets.* */
const ASSETS = (() => {
  const nested = paths && paths.vendor && paths.vendor.assets ? paths.vendor.assets : null;
  const top = paths && paths.assets ? paths.assets : null;
  const a = top || nested;
  // добавим дефолты — чтобы сборка не падала
  const defaults = {
    images: {
      src: 'src/assets/images/**/*.{jpg,jpeg,png,gif,svg,webp,avif}',
      dist: 'dist/assets/images',
      build: 'build/assets/images',
    },
    icons: {
      src: 'src/assets/icons/**/*.{svg,png,ico}',
      dist: 'dist/assets/icons',
      build: 'build/assets/icons',
      faviconSvg: 'src/assets/icons/favicon.svg',
      faviconIcoDist: 'dist/assets/icons/favicon.ico',
    },
    video: {
      src: 'src/assets/video/**/*.mp4',
      dist: 'dist/assets/video',
      build: 'build/assets/video',
      posterExt: '.jpg',
    },
  };
  return Object.assign({}, defaults, a || {});
})();

/* ─────────────── Images / Icons ─────────────── */
function imagesDist() {
  if (!ASSETS || !ASSETS.images) {
    warnMissing('paths.assets.images (config gulpfile)', 'paths');
    return Promise.resolve();
  }
  const imagesBase = baseDirFromGlob(ASSETS.images.src) || 'src/assets/images';
  if (!exists(imagesBase)) warnMissing(`Папка ${imagesBase}`, process.cwd());
  return Promise.all([
    import('gulp-imagemin'),
    import('imagemin-mozjpeg'),
    import('imagemin-pngquant'),
    import('imagemin-svgo')
  ]).then(([{ default: imagemin }, { default: mozjpeg }, { default: pngquant }, { default: svgo }]) => {
    const stream = srcChecked(ASSETS.images.src, { base: imagesBase })
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(newer(ASSETS.images.dist))
      .pipe(imagemin([
        mozjpeg({ quality: 78, progressive: true }),
        pngquant({ quality: [0.7, 0.85], speed: 3 }),
        svgo({
          plugins: [
            { name: 'preset-default', params: { overrides: { removeViewBox: false, convertShapeToPath: false } } },
            { name: 'sortAttrs' }
          ]
        })
      ], { verbose: true }))
      .pipe(gulp.dest(ASSETS.images.dist));
    return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  });
}

function iconsDist() {
  if (!ASSETS || !ASSETS.icons) {
    warnMissing('paths.assets.icons (config gulpfile)', 'paths');
    return Promise.resolve();
  }
  const iconsBase = baseDirFromGlob(ASSETS.icons.src) || 'src/assets/icons';
  if (!exists(iconsBase)) warnMissing(`Папка ${iconsBase}`, process.cwd());
  return Promise.all([
    import('gulp-imagemin'),
    import('imagemin-pngquant'),
    import('imagemin-svgo')
  ]).then(([{ default: imagemin }, { default: pngquant }, { default: svgo }]) => {
    const stream = srcChecked(ASSETS.icons.src, { base: iconsBase })
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(newer(ASSETS.icons.dist))
      .pipe(imagemin([
        pngquant({ quality: [0.7, 0.9], speed: 3 }),
        svgo({
          plugins: [
            { name: 'preset-default', params: { overrides: { removeViewBox: false, convertShapeToPath: false } } },
            { name: 'sortAttrs' }
          ]
        })
      ], { verbose: true }))
      .pipe(gulp.dest(ASSETS.icons.dist));
    return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  });
}

/* ─────────────── Favicon (в пайплайн по желанию) ─────────────── */
async function faviconSvgToIcoDist(done) {
  try {
    if (!ASSETS || !ASSETS.icons || !ASSETS.icons.faviconSvg || !exists(ASSETS.icons.faviconSvg)) {
      warnMissing('favicon.svg', 'src/assets/icons');
      return done && done();
    }
    const svgBuf = fs.readFileSync(ASSETS.icons.faviconSvg);
    const sizes = [16, 32, 48, 64];
    const pngBuffers = await Promise.all(
      sizes.map((s) => sharp(svgBuf, { density: 256 }).resize(s, s).png().toBuffer())
    );
    const icoBuf = await toIco(pngBuffers);
    ensureDirSync(path.dirname(ASSETS.icons.faviconIcoDist));
    fs.writeFileSync(ASSETS.icons.faviconIcoDist, icoBuf);
    log(c.gray('favicon: создан dist/assets/icons/favicon.ico'));
    if (done) done();
  } catch (e) {
    log(c.red(`favicon: ошибка генерации .ico — ${e.message}`));
    if (done) done();
  }
}

/* ─────────────── Video ─────────────── */
function hasFfmpeg() {
  if (ffmpegStatic) return true;
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch { return false; }
}

// Promise-обёртка для fluent-ffmpeg
function runFfmpeg(cmd) {
  return new Promise((resolve, reject) => {
    cmd.on('end', resolve).on('error', reject).run();
  });
}

async function processOneVideo(absIn, distRoot, makeScaled = MAKE_75_PERCENT_VARIANTS) {
  const rel = path.relative(baseDirFromGlob(ASSETS.video.src) || 'src/assets/video', absIn);
  const baseNoExt = rel.replace(/\.[^.]+$/, '');
  const outDir = path.join(distRoot, path.dirname(rel));
  ensureDirSync(outDir);

  const outMp4 = path.join(outDir, `${path.basename(baseNoExt)}.mp4`);
  const outWebm = path.join(outDir, `${path.basename(baseNoExt)}.webm`);
  const outPoster = path.join(outDir, `${path.basename(baseNoExt)}${ASSETS.video.posterExt || '.jpg'}`);

  // основные: mp4/webm mute
  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .noAudio()
        .videoCodec('libx264')
        .outputOptions(['-crf 26', '-preset medium', '-movflags +faststart'])
        .output(outMp4)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: mp4 ${rel} → ${path.relative(process.cwd(), outMp4)}`));
  } catch (e) {
    log(c.yellow(`video: mp4 пропущен (${rel}) — ${e.message}`));
  }

  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .noAudio()
        .videoCodec('libvpx-vp9')
        .outputOptions(['-b:v 0', '-crf 32'])
        .output(outWebm)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: webm ${rel} → ${path.relative(process.cwd(), outWebm)}`));
  } catch (e) {
    log(c.yellow(`video: webm пропущен (${rel}) — ${e.message}`));
  }

  // постер — 1-й кадр
  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .frames(1)
        .outputOptions(['-qscale:v 2'])
        .output(outPoster)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: poster ${rel} → ${path.relative(process.cwd(), outPoster)}`));
  } catch (e) {
    log(c.yellow(`video: poster пропущен (${rel}) — ${e.message}`));
  }

  if (!makeScaled) return;

  // 75%-масштаб (обе версии)
  const scaleFilter = 'scale=trunc(iw*0.75/2)*2:trunc(ih*0.75/2)*2';
  const outMp4s = path.join(outDir, `${path.basename(baseNoExt)}-75.mp4`);
  const outWebms = path.join(outDir, `${path.basename(baseNoExt)}-75.webm`);

  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .noAudio()
        .videoCodec('libx264')
        .videoFilters(scaleFilter)
        .outputOptions(['-crf 27', '-preset medium', '-movflags +faststart'])
        .output(outMp4s)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: mp4-75% ${rel} → ${path.relative(process.cwd(), outMp4s)}`));
  } catch (e) {
    log(c.yellow(`video: mp4-75% пропущен (${rel}) — ${e.message}`));
  }

  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .noAudio()
        .videoCodec('libvpx-vp9')
        .videoFilters(scaleFilter)
        .outputOptions(['-b:v 0', '-crf 33'])
        .output(outWebms)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: webm-75% ${rel} → ${path.relative(process.cwd(), outWebms)}`));
  } catch (e) {
    log(c.yellow(`video: webm-75% пропущен (${rel}) — ${e.message}`));
  }
}

async function videoDist() {
  if (!ASSETS || !ASSETS.video) {
    warnMissing('paths.assets.video (config gulpfile)', 'paths');
    return;
  }
  const base = baseDirFromGlob(ASSETS.video.src) || 'src/assets/video';
  if (!exists(base)) {
    warnMissing(`Папка ${base}`, process.cwd());
    return;
  }

  if (!hasFfmpeg()) {
    warnMissing('ffmpeg (не найден бинарник). Установи: npm i -D ffmpeg-static', 'env');
    return;
  }

  // находим все mp4; инкрементальность через манифест + проверку выходов
  const files = fg.sync(ASSETS.video.src, { dot: false });
  if (!files.length) {
    warnMissing(`Видеофайлы по шаблону "${ASSETS.video.src}"`, process.cwd());
    return;
  }
  const settingsId = videoSettingsId();
  const manifest = loadVideoManifest();
  for (const file of files) {
    try {
      const absIn = path.resolve(file);
      const rel = path.relative(base, absIn);
      const st = fs.statSync(absIn);
      const sig = sha1(`${st.size}:${st.mtimeMs}:${settingsId}`);
      const outs = expectedVideoOutputs(rel);
      const rec = manifest[rel];
      if (rec && rec.sig === sig && outputsAreFresh(outs, st)) {
        log(c.gray(`video: skip unchanged ${rel}`));
        continue;
      }
      await processOneVideo(absIn, ASSETS.video.dist, MAKE_75_PERCENT_VARIANTS);
      manifest[rel] = { sig, outs };
      saveVideoManifest(manifest);
    } catch (e) {
      log(c.yellow(`video: пропуск файла ${file} — ${e.message}`));
    }
  }
}

/* ─────────────── Copy media dist → build ─────────────── */
function mediaBuildCopy() {
  // Копируем всё из dist/assets/** в build/assets/** с сохранением структуры
  return gulp.src(['dist/assets/**/*'], { base: 'dist' })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(gulp.dest('build'));
}

/* ─────────────── Clean (без del) ─────────────── */
function cleanDist(done) { rmDirSafe(paths.dist); done(); }
function cleanBuild(done) { rmDirSafe(paths.build); done(); }
function pruneDistEmpty(done) { pruneEmptyUnder(paths.dist); done(); }
function pruneBuildEmpty(done) { pruneEmptyUnder(paths.build); done(); }

/* ─────────────── HTML ─────────────── */
function htmlDist() {
  if (!exists(paths.src)) warnMissing('Папка src', process.cwd());
  return srcChecked(paths.html.src, { base: paths.src })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(fileinclude({ prefix: '@@', basepath: '@file' }))
    .pipe(gulp.dest(paths.html.dist));
}

function htmlBuild() {
  if (!exists(paths.src)) warnMissing('Папка src', process.cwd());
  let stream = srcChecked(paths.html.src, { base: paths.src })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(fileinclude({ prefix: '@@', basepath: '@file' }));

  if (USE_MIN_SUFFIX) {
    stream = stream
      .pipe(replace(/(href=["'][^"']*?vendor\/normalize)\.css(["'])/g, '$1.min.css$2'))
      .pipe(replace(/(href=["'][^"']*?\/css\/[^"']+?)\.css(["'])/g, '$1.min.css$2'))
      .pipe(replace(/(src=["'][^"']*?\/js\/[^"']+?)\.js(["'])/g, '$1.min.js$2'));
  }

  return stream
    .pipe(htmlmin({
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: false,
      minifyJS: false,
    }))
    .pipe(gulp.dest(paths.html.build));
}

/* ─────────────── HTML FAST (инкрементально только для страниц, не для partials) ─────────────── */
function htmlDistFast() {
  if (!exists(paths.src)) warnMissing('Папка src', process.cwd());
  const NAME = 'html:dist';
  return gulp.src(paths.html.src, { base: paths.src, since: gulp.lastRun(htmlDistFast) })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(cached(NAME))
    .pipe(fileinclude({ prefix: '@@', basepath: '@file' }))
    .pipe(remember(NAME))
    .pipe(gulp.dest(paths.html.dist));
}
function htmlBuildFast() {
  if (!exists(paths.src)) warnMissing('Папка src', process.cwd());
  const NAME = 'html:build';
  let stream = gulp.src(paths.html.src, { base: paths.src, since: gulp.lastRun(htmlBuildFast) })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(cached(NAME))
    .pipe(fileinclude({ prefix: '@@', basepath: '@file' }));
  if (USE_MIN_SUFFIX) {
    stream = stream
      .pipe(replace(/(href=["'][^"']*?vendor\/normalize)\.css(["'])/g, '$1.min.css$2'))
      .pipe(replace(/(href=["'][^"']*?\/css\/[^"']+?)\.css(["'])/g, '$1.min.css$2'))
      .pipe(replace(/(src=["'][^"']*?\/js\/[^"']+?)\.js(["'])/g, '$1.min.js$2'));
  }
  return stream
    .pipe(remember(NAME))
    .pipe(htmlmin({ collapseWhitespace: true, removeComments: true, minifyCSS: false, minifyJS: false }))
    .pipe(gulp.dest(paths.html.build));
}

/* ─────────────── Styles (SCSS→CSS) ─────────────── */
function stylesDist() {
  if (!exists(path.dirname(paths.styles.entry))) {
    warnMissing('Папка src/styles', process.cwd());
  }
  return srcChecked(paths.styles.entry)
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(sourcemaps.init())
    .pipe(sass({ outputStyle: 'expanded' }))
    .pipe(postcss([autoprefixer()]))
    .pipe(gcmq())
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest(paths.styles.dist));
}

function stylesBuild() {
  if (!exists(path.dirname(paths.styles.entry))) {
    warnMissing('Папка src/styles', process.cwd());
  }
  return import('cssnano').then(({ default: cssnano }) => {
    let stream = srcChecked(paths.styles.entry)
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(sass({ outputStyle: 'expanded' }))
      .pipe(postcss([autoprefixer()]))
      .pipe(gcmq())
      .pipe(postcss([cssnano()]));
    if (USE_MIN_SUFFIX) stream = stream.pipe(rename({ suffix: '.min' }));
    stream = stream.pipe(gulp.dest(paths.styles.build));
    return new Promise((resolve, reject) => {
      stream.on('end', resolve).on('error', reject);
    });
  });
}

/* ─────────────── Scripts (JS) ─────────────── */
function scriptsDist() {
  if (!exists('src/js')) warnMissing('Папка src/js', process.cwd());
  const NAME = 'scripts:dist';
  return srcChecked(paths.scripts.src, { base: 'src/js', since: gulp.lastRun(scriptsDist) })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(cached(NAME))
    .pipe(sourcemaps.init())
    .pipe(remember(NAME))
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest(paths.scripts.dist));
}

function scriptsBuild() {
  if (!exists('src/js')) warnMissing('Папка src/js', process.cwd());
  const NAME = 'scripts:build';
  let stream = srcChecked(paths.scripts.src, { base: 'src/js', since: gulp.lastRun(scriptsBuild) })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(cached(NAME))
    .pipe(terser())
    .pipe(remember(NAME));
  if (USE_MIN_SUFFIX) stream = stream.pipe(rename({ suffix: '.min' }));
  return stream.pipe(gulp.dest(paths.scripts.build));
}

/* ─────────────── Vendor (UIkit + normalize.css) ─────────────── */
function vendorDist() {
  const streams = [];
  streams.push(
    srcChecked(paths.vendor.normalize, { allowEmpty: true })
      .pipe(gulp.dest(paths.vendor.dist))
  );
  streams.push(
    srcChecked(paths.vendor.uikitCss, { allowEmpty: true, since: gulp.lastRun(vendorDist) })
      .pipe(gulp.dest(paths.vendor.dist))
  );
  streams.push(
    srcChecked(paths.vendor.uikitJs, { allowEmpty: true, since: gulp.lastRun(vendorDist) })
      .pipe(gulp.dest(paths.vendor.dist))
  );
  return mergeStream(...streams);
}

function vendorBuild() {
  const streams = [];
  return import('cssnano').then(({ default: cssnano }) => {
    let normalize = srcChecked(paths.vendor.normalize, { allowEmpty: true })
      .pipe(postcss([cssnano()]));
    if (USE_MIN_SUFFIX) normalize = normalize.pipe(rename({ suffix: '.min' }));
    streams.push(normalize.pipe(gulp.dest(paths.vendor.build)));

    streams.push(
      srcChecked(paths.vendor.uikitCss, { allowEmpty: true }).pipe(gulp.dest(paths.vendor.build))
    );
    streams.push(
      srcChecked(paths.vendor.uikitJs, { allowEmpty: true }).pipe(gulp.dest(paths.vendor.build))
    );
    return mergeStream(...streams);
  });
}

/* ─────────────── Watch (раздельно: code / media) ─────────────── */
function watchCode() {
  // страницы (инкрементально)
  const wPages = gulp.watch('src/*.html', gulp.series(htmlDistFast, htmlBuildFast, pruneDistEmpty, pruneBuildEmpty));
  wPages.on('unlink', (fp) => dropFromCaches('html:dist', path.resolve(fp)));
  wPages.on('unlink', (fp) => dropFromCaches('html:build', path.resolve(fp)));
  wPages.on('unlink', (fp) => deleteHtmlOutputsOnUnlink(path.resolve(fp)));
  // partials → полная пересборка страниц
  gulp.watch('src/partials/**/*.html', gulp.series(htmlDist, htmlBuild, pruneDistEmpty, pruneBuildEmpty));
  // стили (main.scss компилим всегда — быстро)
  gulp.watch(paths.styles.src, gulp.series(stylesDist, stylesBuild, pruneDistEmpty, pruneBuildEmpty));
  // скрипты (инкрементально)
  const wScripts = gulp.watch(paths.scripts.src, gulp.series(scriptsDist, scriptsBuild, pruneDistEmpty, pruneBuildEmpty));
  wScripts.on('unlink', (fp) => dropFromCaches('scripts:dist', path.resolve(fp)));
  wScripts.on('unlink', (fp) => dropFromCaches('scripts:build', path.resolve(fp)));
  wScripts.on('unlink', (fp) => deleteJsOutputsOnUnlink(path.resolve(fp)));
  // vendor
  gulp.watch([paths.vendor.normalize, paths.vendor.uikitCss, ...paths.vendor.uikitJs],
    gulp.series(vendorDist, vendorBuild, pruneDistEmpty, pruneBuildEmpty));
}
function watchMedia() {
  const wImg = gulp.watch(ASSETS.images.src, gulp.series(imagesDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  wImg.on('unlink', (fp) => { deleteImageOutputsOnUnlink(path.resolve(fp)); pruneDistEmpty(() => { }); pruneBuildEmpty(() => { }); });
  const wIco = gulp.watch(ASSETS.icons.src, gulp.series(iconsDist, /*faviconSvgToIcoDist,*/ mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  wIco.on('unlink', (fp) => { deleteIconOutputsOnUnlink(path.resolve(fp)); pruneDistEmpty(() => { }); pruneBuildEmpty(() => { }); });
  const wVid = gulp.watch(ASSETS.video.src, gulp.series(videoDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  wVid.on('unlink', (fp) => { deleteVideoOutputsOnUnlink(path.resolve(fp)); pruneDistEmpty(() => { }); pruneBuildEmpty(() => { }); });
}
function watchFiles() {
  if (ONLY_MEDIA) return watchMedia();
  if (SKIP_MEDIA) return watchCode();
  watchCode(); watchMedia();
}

/* ─────────────── Orphans scan (разовая очистка осиротевших медиа) ─────────────── */
function scanRemoveOrphansImages() {
  const distRoot = ASSETS.images.dist;
  if (!exists(distRoot)) return Promise.resolve();
  const base = baseDirFromGlob(ASSETS.images.src) || 'src/assets/images';
  const files = fg.sync(path.join(distRoot, '**/*'), { onlyFiles: true });
  for (const f of files) {
    const rel = path.relative(distRoot, f);
    const srcPath = path.join(base, rel);
    if (!exists(srcPath)) { rmFileSafe(f); const inBuild = path.join('build', path.relative('dist', f)); rmIfExists(inBuild); }
  }
  return Promise.resolve();
}
function scanRemoveOrphansIcons() {
  const distRoot = ASSETS.icons.dist;
  if (!exists(distRoot)) return Promise.resolve();
  const base = baseDirFromGlob(ASSETS.icons.src) || 'src/assets/icons';
  const files = fg.sync(path.join(distRoot, '**/*'), { onlyFiles: true });
  for (const f of files) {
    // favicon.ico оставляем, только если есть favicon.svg
    if (path.basename(f) === 'favicon.ico' && ASSETS.icons.faviconSvg && exists(ASSETS.icons.faviconSvg)) continue;
    const rel = path.relative(distRoot, f);
    const srcPath = path.join(base, rel);
    if (!exists(srcPath)) { rmFileSafe(f); const inBuild = path.join('build', path.relative('dist', f)); rmIfExists(inBuild); }
  }
  return Promise.resolve();
}
function scanRemoveOrphansVideo() {
  const distRoot = ASSETS.video.dist;
  if (!exists(distRoot)) return Promise.resolve();
  // построим список всех ожидаемых выходов из существующих исходников
  const base = baseDirFromGlob(ASSETS.video.src) || 'src/assets/video';
  const srcFiles = fg.sync(ASSETS.video.src, { onlyFiles: true });
  const expected = new Set();
  for (const s of srcFiles) {
    const rel = path.relative(base, s);
    for (const o of expectedVideoOutputs(rel)) expected.add(path.resolve(o));
  }
  // пройдёмся по dist и удалим всё лишнее
  const files = fg.sync(path.join(distRoot, '**/*'), { onlyFiles: true });
  for (const f of files) {
    if (!expected.has(path.resolve(f))) { rmFileSafe(f); const inBuild = path.join('build', path.relative('dist', f)); rmIfExists(inBuild); }
  }
  // зачистим манифест от несуществующих исходников
  const man = loadVideoManifest();
  const keep = {};
  for (const s of srcFiles) {
    const rel = path.relative(base, s);
    if (man[rel]) keep[rel] = man[rel];
  }
  saveVideoManifest(keep);
  return Promise.resolve();
}
const orphans = gulp.series(scanRemoveOrphansImages, scanRemoveOrphansIcons, scanRemoveOrphansVideo, pruneDistEmpty, pruneBuildEmpty);
exports.orphans = orphans;

/* ─────────────── Public tasks ─────────────── */
const codeDist = gulp.parallel(htmlDist, stylesDist, scriptsDist, vendorDist);
const codeBuild = gulp.parallel(htmlBuild, stylesBuild, scriptsBuild, vendorBuild);
const mediaDist = gulp.parallel(imagesDist, iconsDist, faviconSvgToIcoDist, videoDist);

// dev-пайплайн с флагами --skip-media / --only-media + опциональная очистка + .nojekyll + orphans
const buildBoth = gulp.series(
  NO_CLEAN ? noop : gulp.series(cleanDist, cleanBuild),
  gulp.parallel(ONLY_MEDIA ? noop : codeDist, SKIP_MEDIA ? noop : mediaDist),
  gulp.parallel(ONLY_MEDIA ? noop : codeBuild, SKIP_MEDIA ? noop : mediaBuildCopy),
  pagesNoJekyll,
  orphans,
  gulp.parallel(pruneDistEmpty, pruneBuildEmpty)
);

const start = gulp.series(buildBoth, watchFiles);

const buildDist = gulp.series(cleanDist, codeDist, pruneDistEmpty);
const build = gulp.series(cleanBuild, codeBuild, pagesNoJekyll, pruneBuildEmpty);

exports.dev = buildBoth;
exports.start = start;
exports['build:dist'] = buildDist;
exports.build = build;

exports.cleanDist = cleanDist;
exports.cleanBuild = cleanBuild;
exports.pruneDistEmpty = pruneDistEmpty;
exports.pruneBuildEmpty = pruneBuildEmpty;

exports.htmlDist = htmlDist;
exports.htmlDistFast = htmlDistFast;
exports.htmlBuild = htmlBuild;
exports.htmlBuildFast = htmlBuildFast;
exports.stylesDist = stylesDist;
exports.stylesBuild = stylesBuild;
exports.scriptsDist = scriptsDist;
exports.scriptsBuild = scriptsBuild;
exports.vendorDist = vendorDist;
exports.vendorBuild = vendorBuild;

exports.imagesDist = imagesDist;
exports.iconsDist = iconsDist;
exports.videoDist = videoDist;
exports.faviconSvgToIcoDist = faviconSvgToIcoDist;
exports.mediaBuildCopy = mediaBuildCopy;
exports.watchCode = watchCode;
exports.watchMedia = watchMedia;
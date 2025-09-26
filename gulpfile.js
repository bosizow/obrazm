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

const newer = require('gulp-newer');
const sharp = require('sharp');
const toIco = require('to-ico');

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
  // если ffmpeg-static не дал путь — надеемся на системный ffmpeg в PATH
  return Boolean(ffmpegStatic) || process.env.PATH.split(path.delimiter).some(() => true);
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

  // находим все mp4; newer тут не применим: генерим несколько выходов, проверяем сами
  const files = fg.sync(ASSETS.video.src, { dot: false });
  if (!files.length) {
    warnMissing(`Видеофайлы по шаблону "${ASSETS.video.src}"`, process.cwd());
    return;
  }
  for (const file of files) {
    try {
      await processOneVideo(path.resolve(file), ASSETS.video.dist, MAKE_75_PERCENT_VARIANTS);
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
  return srcChecked(paths.scripts.src, { base: 'src/js' })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(sourcemaps.init())
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest(paths.scripts.dist));
}

function scriptsBuild() {
  if (!exists('src/js')) warnMissing('Папка src/js', process.cwd());
  let stream = srcChecked(paths.scripts.src, { base: 'src/js' })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(terser());
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
    srcChecked(paths.vendor.uikitCss, { allowEmpty: true })
      .pipe(gulp.dest(paths.vendor.dist))
  );
  streams.push(
    srcChecked(paths.vendor.uikitJs, { allowEmpty: true })
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

/* ─────────────── Watch ─────────────── */
function watchFiles() {
  gulp.watch(paths.html.watch, gulp.series(htmlDist, htmlBuild, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(paths.styles.src, gulp.series(stylesDist, stylesBuild, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(paths.scripts.src, gulp.series(scriptsDist, scriptsBuild, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(ASSETS.images.src, gulp.series(imagesDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(ASSETS.icons.src, gulp.series(iconsDist, /*faviconSvgToIcoDist,*/ mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(ASSETS.video.src, gulp.series(videoDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
}

/* ─────────────── Public tasks ─────────────── */
const codeDist = gulp.parallel(htmlDist, stylesDist, scriptsDist, vendorDist);
const codeBuild = gulp.parallel(htmlBuild, stylesBuild, scriptsBuild, vendorBuild);
const mediaDist = gulp.parallel(imagesDist, iconsDist, videoDist); // favicon можно добавить сюда при желании

const buildBoth = gulp.series(
  cleanDist,
  cleanBuild,
  gulp.parallel(codeDist, mediaDist),        // dist: код + медиа (вкл. видео)
  gulp.parallel(codeBuild, mediaBuildCopy),  // build: код + копия медиа из dist
  gulp.parallel(pruneDistEmpty, pruneBuildEmpty)
);

const start = gulp.series(buildBoth, watchFiles);

const buildDist = gulp.series(cleanDist, codeDist, pruneDistEmpty);
const build = gulp.series(cleanBuild, codeBuild, pruneBuildEmpty);

exports.dev = buildBoth;
exports.start = start;
exports['build:dist'] = buildDist;
exports.build = build;

exports.cleanDist = cleanDist;
exports.cleanBuild = cleanBuild;
exports.pruneDistEmpty = pruneDistEmpty;
exports.pruneBuildEmpty = pruneBuildEmpty;

exports.htmlDist = htmlDist;
exports.htmlBuild = htmlBuild;
exports.stylesDist = stylesDist;
exports.stylesBuild = stylesBuild;
exports.scriptsDist = scriptsDist;
exports.scriptsBuild = scriptsBuild;
exports.vendorDist = vendorDist;
exports.vendorBuild = vendorBuild;

exports.imagesDist = imagesDist;
exports.iconsDist = iconsDist;
exports.videoDist = videoDist;
exports.faviconSvgToIcoDist = faviconSvgToIcoDist; // не в пайплайне по умолчанию
exports.mediaBuildCopy = mediaBuildCopy;
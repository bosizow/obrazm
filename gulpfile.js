/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const gulp = require('gulp');
const plumber = require('gulp-plumber');
const log = require('fancy-log');
const c = require('ansi-colors');
const minimist = require('minimist');

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

const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

/* ───────────────────────────────────────────────────────────
   CLI флаги
   ─────────────────────────────────────────────────────────── */
const argv = minimist(process.argv.slice(2));
const SKIP_MEDIA = Boolean(argv['skip-media']);
const ONLY_MEDIA = Boolean(argv['only-media']);
const NO_CLEAN = Boolean(argv['no-clean'] || argv.preserve);
const SKIP_VIDEO = Boolean(argv['skip-video']);
const noop = (done) => done();

/* ───────────────────────────────────────────────────────────
   Конфиг
   ─────────────────────────────────────────────────────────── */
const USE_MIN_SUFFIX = false; // true → *.min.css / *.min.js в build

// Видео: «scaled-only»
const VIDEO_SCALE = 0.75;       // коэффициент масштаба (75%)
const VIDEO_SCALED_ONLY = true; // генерим только уменьшенные версии (без -75.*)

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
    // новая директория со SCSS
    dir: 'src/css',
    // любые scss (для вотчера)
    src: 'src/css/**/*.scss',
    // входы (компилируем всё, кроме _*.scss)
    entries: ['src/css/*.scss', '!src/css/_*.scss'],
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
};

// Медиа отдельно (не внутри vendor)
const ASSETS = {
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
  seo: {
    // наши SEO-файлы в src
    src: ['src/robots.txt', 'src/sitemap.xml'],
    // целевые места — корни dist и build
    dist: 'dist',
    build: 'build',
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
function ensureDirSync(dir) { fs.mkdirSync(dir, { recursive: true }); }

function srcChecked(globPattern, opts = {}) {
  const files = fg.sync(globPattern, { dot: false });
  if (!files.length) warnMissing(`Файлы по шаблону "${globPattern}"`, process.cwd());
  return gulp.src(globPattern, { allowEmpty: true, ...opts });
}

function removeEmptyDirsRecursive(dir) {
  if (!exists(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) if (e.isDirectory()) removeEmptyDirsRecursive(path.join(dir, e.name));
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      log(c.gray(`prune: removed empty ${dir}`));
    }
  } catch { }
}
function pruneEmptyUnder(root) {
  if (!exists(root)) return;
  for (const e of fs.readdirSync(root, { withFileTypes: true }))
    if (e.isDirectory()) removeEmptyDirsRecursive(path.join(root, e.name));
}

/* ─────────────── utils: base dir from glob ─────────────── */
function baseDirFromGlob(globStr) {
  const g = Array.isArray(globStr) ? globStr[0] : globStr;
  if (!g) return null;
  const i = g.indexOf('**');
  if (i > -1) {
    // кусок до '**', без завершающих слэшей
    return g.slice(0, i).replace(/[\\/]+$/, '');
  }
  // если нет '**', берём всё до первой фигурной скобки (для {...}),
  // затем убираем завершающие слэши
  const j = g.indexOf('{');
  const head = j > -1 ? g.slice(0, j) : g;
  return head.replace(/[\\/]+$/, '');
}

/* ─────────────── site.json helper ─────────────── */
function loadSiteJson() {
  const p = path.join(paths.src, 'site.json');
  try {
    if (exists(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    }
    warnMissing('site.json', paths.src);
    return {};
  } catch (e) {
    log(c.yellow(`⚠ site.json: ошибка парсинга — ${e.message}. Использую пустой объект.`));
    return {};
  }
}

/* ─────────────── GitHub Pages helper (.nojekyll) ─────────────── */
function pagesNoJekyll(done) {
  try {
    const srcNoJekyll = path.join(paths.src, '.nojekyll');
    ensureDirSync(paths.build);
    if (exists(srcNoJekyll)) {
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

/* ─────────────── Images / Icons ─────────────── */
function imagesDist() {
  if (!exists('src/assets/images')) warnMissing('Папка src/assets/images', process.cwd());
  return Promise.all([
    import('gulp-imagemin'),
    import('imagemin-mozjpeg'),
    import('imagemin-pngquant'),
    import('imagemin-svgo'),
  ]).then(([{ default: imagemin }, { default: mozjpeg }, { default: pngquant }, { default: svgo }]) => {
    const stream = srcChecked(ASSETS.images.src, { base: 'src/assets/images' })
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(newer(ASSETS.images.dist))
      .pipe(imagemin([
        mozjpeg({ quality: 78, progressive: true }),
        pngquant({ quality: [0.7, 0.85], speed: 3 }),
        svgo({
          plugins: [
            { name: 'preset-default', params: { overrides: { removeViewBox: false, convertShapeToPath: false } } },
            { name: 'sortAttrs' },
          ],
        }),
      ], { verbose: true }))
      .pipe(gulp.dest(ASSETS.images.dist));
    return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  });
}

function iconsDist() {
  if (!exists('src/assets/icons')) warnMissing('Папка src/assets/icons', process.cwd());
  return Promise.all([
    import('gulp-imagemin'),
    import('imagemin-pngquant'),
    import('imagemin-svgo'),
  ]).then(([{ default: imagemin }, { default: pngquant }, { default: svgo }]) => {
    const stream = srcChecked(ASSETS.icons.src, { base: 'src/assets/icons' })
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(newer(ASSETS.icons.dist))
      .pipe(imagemin([
        pngquant({ quality: [0.7, 0.9], speed: 3 }),
        svgo({
          plugins: [
            { name: 'preset-default', params: { overrides: { removeViewBox: false, convertShapeToPath: false } } },
            { name: 'sortAttrs' },
          ],
        }),
      ], { verbose: true }))
      .pipe(gulp.dest(ASSETS.icons.dist));
    return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  });
}

async function faviconSvgToIcoDist(done) {
  try {
    if (!exists(ASSETS.icons.faviconSvg)) {
      warnMissing('favicon.svg', 'src/assets/icons');
      return done();
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
    done();
  } catch (e) {
    log(c.red(`favicon: ошибка генерации .ico — ${e.message}`));
  }
}

function mediaBuildCopy() {
  return gulp.src(['dist/assets/**/*'], { base: 'dist' })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(gulp.dest('build'));
}

/* ─────────────── SEO files: robots.txt & sitemap.xml ─────────────── */
function seoDist() {
  // копируем из src/ → dist/ (корень)
  return srcChecked(ASSETS.seo.src, { base: 'src', allowEmpty: true })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(newer(paths.dist))
    .pipe(gulp.dest(paths.dist));
}
function seoBuild() {
  // копируем из dist/ → build/ (корень), чтобы build = «мин. код + те же мета-файлы»
  return gulp.src(['dist/robots.txt', 'dist/sitemap.xml'], { base: 'dist', allowEmpty: true })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(newer(paths.build))
    .pipe(gulp.dest(paths.build));
}

/* ─────────────── Clean (без del) ─────────────── */
function cleanDist(done) { if (!NO_CLEAN) rmDirSafe(paths.dist); done(); }
function cleanBuild(done) { if (!NO_CLEAN) rmDirSafe(paths.build); done(); }
function pruneDistEmpty(done) { pruneEmptyUnder(paths.dist); done(); }
function pruneBuildEmpty(done) { pruneEmptyUnder(paths.build); done(); }

/* ─────────────── HTML ─────────────── */
function htmlDist() {
  if (!exists(paths.src)) warnMissing('Папка src', process.cwd());
  const SITE = loadSiteJson();
  return srcChecked(paths.html.src, { base: paths.src })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(fileinclude({
      prefix: '@@',
      basepath: '@file',
      context: { SITE },
    }))
    .pipe(gulp.dest(paths.html.dist));
}

function htmlBuild() {
  if (!exists(paths.src)) warnMissing('Папка src', process.cwd());
  const SITE = loadSiteJson();
  let stream = srcChecked(paths.html.src, { base: paths.src })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(fileinclude({
      prefix: '@@',
      basepath: '@file',
      context: { SITE },
    }));

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
  if (!exists(paths.styles.dir)) {
    warnMissing('Папка src/css', process.cwd());
  }
  // компилируем все явные точки входа (main.scss, index.scss и т.д.)
  return srcChecked(paths.styles.entries, { base: paths.styles.dir })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(sourcemaps.init())
    .pipe(sass({ outputStyle: 'expanded' }))
    .pipe(postcss([autoprefixer()]))
    .pipe(gcmq())
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest(paths.styles.dist));
}

function stylesBuild() {
  if (!exists(paths.styles.dir)) {
    warnMissing('Папка src/css', process.cwd());
  }
  return import('cssnano').then(({ default: cssnano }) => {
    let stream = srcChecked(paths.styles.entries, { base: paths.styles.dir })
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(sass({ outputStyle: 'expanded' }))
      .pipe(postcss([autoprefixer()]))
      .pipe(gcmq())
      .pipe(postcss([cssnano()])); // минификация для build
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
  streams.push(srcChecked(paths.vendor.normalize, { allowEmpty: true }).pipe(gulp.dest(paths.vendor.dist)));
  streams.push(srcChecked(paths.vendor.uikitCss, { allowEmpty: true }).pipe(gulp.dest(paths.vendor.dist)));
  streams.push(srcChecked(paths.vendor.uikitJs, { allowEmpty: true }).pipe(gulp.dest(paths.vendor.dist)));
  return mergeStream(...streams);
}
function vendorBuild() {
  return import('cssnano').then(({ default: cssnano }) => {
    const streams = [];
    let normalize = srcChecked(paths.vendor.normalize, { allowEmpty: true })
      .pipe(postcss([cssnano()]));
    if (USE_MIN_SUFFIX) normalize = normalize.pipe(rename({ suffix: '.min' }));
    streams.push(normalize.pipe(gulp.dest(paths.vendor.build)));
    streams.push(srcChecked(paths.vendor.uikitCss, { allowEmpty: true }).pipe(gulp.dest(paths.vendor.build)));
    streams.push(srcChecked(paths.vendor.uikitJs, { allowEmpty: true }).pipe(gulp.dest(paths.vendor.build)));
    return mergeStream(...streams);
  });
}

/* ─────────────── Video: инкрементальная обработка + scaled-only ─────────────── */
const VIDEO_CACHE_FILE = '.cache/video.json';
function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
function loadVideoManifest() { try { return JSON.parse(fs.readFileSync(VIDEO_CACHE_FILE, 'utf8')); } catch { return {}; } }
function saveVideoManifest(man) { ensureDirSync(path.dirname(VIDEO_CACHE_FILE)); fs.writeFileSync(VIDEO_CACHE_FILE, JSON.stringify(man, null, 2)); }

function videoSettingsId() {
  return JSON.stringify({
    mp4: { crf: 26, preset: 'medium' },
    webm: { crf: 32, bv0: true },
    scaledOnly: VIDEO_SCALED_ONLY,
    scale: VIDEO_SCALE,
    posterExt: (ASSETS.video && ASSETS.video.posterExt) || '.jpg',
  });
}
function expectedVideoOutputs(relInput) {
  const baseNoExt = relInput.replace(/\.[^.]+$/, '');
  const outDir = path.join(ASSETS.video.dist, path.dirname(relInput));
  const posterExt = (ASSETS.video && ASSETS.video.posterExt) || '.jpg';
  return [
    path.join(outDir, `${path.basename(baseNoExt)}.mp4`),
    path.join(outDir, `${path.basename(baseNoExt)}.webm`),
    path.join(outDir, `${path.basename(baseNoExt)}${posterExt}`),
  ];
}
function outputsAreFresh(outs, srcStat) {
  try { return outs.length > 0 && outs.every((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= srcStat.mtimeMs); }
  catch { return false; }
}
function hasFfmpeg() {
  if (ffmpegStatic) return true;
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; }
  catch { return false; }
}
function runFfmpeg(cmd) {
  return new Promise((resolve, reject) => { cmd.on('end', resolve).on('error', reject).run(); });
}

async function processOneVideo(absIn, distRoot) {
  const rel = path.relative(baseDirFromGlob(ASSETS.video.src) || 'src/assets/video', absIn);
  const baseNoExt = rel.replace(/\.[^.]+$/, '');
  const outDir = path.join(distRoot, path.dirname(rel));
  ensureDirSync(outDir);

  const outMp4 = path.join(outDir, `${path.basename(baseNoExt)}.mp4`);
  const outWebm = path.join(outDir, `${path.basename(baseNoExt)}.webm`);
  const outPoster = path.join(outDir, `${path.basename(baseNoExt)}${ASSETS.video.posterExt || '.jpg'}`);

  const scaleFilter = `scale=trunc(iw*${VIDEO_SCALE}/2)*2:trunc(ih*${VIDEO_SCALE}/2)*2`;

  // mp4 (scaled, mute)
  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .noAudio()
        .videoCodec('libx264')
        .videoFilters(scaleFilter)
        .outputOptions(['-crf 27', '-preset medium', '-movflags +faststart'])
        .output(outMp4)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: mp4 (scaled ${Math.round(VIDEO_SCALE * 100)}%) ${rel} → ${path.relative(process.cwd(), outMp4)}`));
  } catch (e) {
    log(c.yellow(`video: mp4 пропущен (${rel}) — ${e.message}`));
  }

  // webm (scaled, mute)
  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .noAudio()
        .videoCodec('libvpx-vp9')
        .videoFilters(scaleFilter)
        .outputOptions(['-b:v 0', '-crf 32'])
        .output(outWebm)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: webm (scaled ${Math.round(VIDEO_SCALE * 100)}%) ${rel} → ${path.relative(process.cwd(), outWebm)}`));
  } catch (e) {
    log(c.yellow(`video: webm пропущен (${rel}) — ${e.message}`));
  }

  // постер (первый кадр)
  try {
    await runFfmpeg(
      ffmpeg(absIn)
        .frames(1)
        .outputOptions(['-q:v 2'])
        .output(outPoster)
        .outputOptions(['-y'])
    );
    log(c.gray(`video: poster ${rel} → ${path.relative(process.cwd(), outPoster)}`));
  } catch (e) {
    log(c.yellow(`video: poster пропущен (${rel}) — ${e.message}`));
  }
}

async function videoDist() {
  if (!ASSETS || !ASSETS.video) { warnMissing('paths.assets.video (config gulpfile)', 'paths'); return; }
  if (!hasFfmpeg()) { log(c.yellow('⚠ ffmpeg не найден. Пропускаю видео.')); return; }

  const base = baseDirFromGlob(ASSETS.video.src) || 'src/assets/video';
  const files = fg.sync(ASSETS.video.src, { dot: false });
  if (!files.length) { warnMissing(`Видеофайлы по шаблону "${ASSETS.video.src}"`, process.cwd()); return; }

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
      await processOneVideo(absIn, ASSETS.video.dist);
      manifest[rel] = { sig, outs };
      saveVideoManifest(manifest);
    } catch (e) {
      log(c.yellow(`video: пропуск файла ${file} — ${e.message}`));
    }
  }
}

/* ─────────────── HTML/CSS/JS/Vendor/SEO bundles ─────────────── */
const codeDist = gulp.parallel(htmlDist, stylesDist, scriptsDist, vendorDist, seoDist);
const codeBuild = gulp.parallel(htmlBuild, stylesBuild, scriptsBuild, vendorBuild, seoBuild);

/* ─────────────── Media bundle ─────────────── */
const mediaDist = gulp.parallel(
  imagesDist,
  iconsDist,
  faviconSvgToIcoDist,
  SKIP_VIDEO ? (d) => d() : videoDist
);

/* ─────────────── Watchers ─────────────── */
function watchCode() {
  gulp.watch([...paths.html.watch, path.join(paths.src, 'site.json')],
    gulp.series(htmlDist, htmlBuild, pruneDistEmpty, pruneBuildEmpty)
  );
  gulp.watch(paths.styles.src, gulp.series(stylesDist, stylesBuild, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(paths.scripts.src, gulp.series(scriptsDist, scriptsBuild, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch([paths.vendor.normalize, paths.vendor.uikitCss, ...paths.vendor.uikitJs],
    gulp.series(vendorDist, vendorBuild, pruneDistEmpty, pruneBuildEmpty));
  // вотчер для robots/sitemap
  gulp.watch(ASSETS.seo.src, gulp.series(seoDist, seoBuild, pruneDistEmpty, pruneBuildEmpty));
}
function watchMedia() {
  gulp.watch(ASSETS.images.src, gulp.series(imagesDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(ASSETS.icons.src, gulp.series(iconsDist, faviconSvgToIcoDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  if (!SKIP_VIDEO) {
    gulp.watch(ASSETS.video.src, gulp.series(videoDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  }
}

/* ─────────────── Orphans scan (уборка осиротевших медиа) ─────────────── */
function rmFileSafe(p) { try { fs.rmSync(p, { force: true }); } catch { } }
function rmIfExists(p) { if (exists(p)) rmFileSafe(p); }

function scanRemoveOrphansImages() {
  const distRoot = ASSETS.images.dist;
  if (!exists(distRoot)) return Promise.resolve();
  const base = baseDirFromGlob(ASSETS.images.src) || 'src/assets/images';
  const files = fg.sync(path.join(distRoot, '**/*'), { onlyFiles: true });
  for (const f of files) {
    const rel = path.relative(distRoot, f);
    const srcPath = path.join(base, rel);
    if (!exists(srcPath)) {
      log(c.gray(`orphans(images): remove ${path.relative(process.cwd(), f)} (no src: ${srcPath})`));
      rmFileSafe(f);
      const inBuild = path.join('build', path.relative('dist', f));
      rmIfExists(inBuild);
    }
  }
  return Promise.resolve();
}
function scanRemoveOrphansIcons() {
  const distRoot = ASSETS.icons.dist;
  if (!exists(distRoot)) return Promise.resolve();
  const base = baseDirFromGlob(ASSETS.icons.src) || 'src/assets/icons';
  const files = fg.sync(path.join(distRoot, '**/*'), { onlyFiles: true });
  for (const f of files) {
    if (path.basename(f) === 'favicon.ico' && ASSETS.icons.faviconSvg && exists(ASSETS.icons.faviconSvg)) continue;
    const rel = path.relative(distRoot, f);
    const srcPath = path.join(base, rel);
    if (!exists(srcPath)) {
      rmFileSafe(f);
      const inBuild = path.join('build', path.relative('dist', f));
      rmIfExists(inBuild);
    }
  }
  return Promise.resolve();
}
function scanRemoveOrphansVideo() {
  const distRoot = ASSETS.video.dist;
  if (!exists(distRoot)) return Promise.resolve();
  const base = baseDirFromGlob(ASSETS.video.src) || 'src/assets/video';
  const srcFiles = fg.sync(ASSETS.video.src, { onlyFiles: true });
  const expected = new Set();
  for (const s of srcFiles) {
    const rel = path.relative(base, s);
    for (const o of expectedVideoOutputs(rel)) expected.add(path.resolve(o));
  }
  const files = fg.sync(path.join(distRoot, '**/*'), { onlyFiles: true });
  for (const f of files) {
    if (!expected.has(path.resolve(f))) {
      rmFileSafe(f);
      const inBuild = path.join('build', path.relative('dist', f));
      rmIfExists(inBuild);
    }
  }
  // подчистка манифеста
  const man = loadVideoManifest();
  const keep = {};
  for (const s of srcFiles) {
    const rel = path.relative(base, s);
    if (man[rel]) keep[rel] = man[rel];
  }
  saveVideoManifest(keep);
  return Promise.resolve();
}
const orphans = gulp.series(
  scanRemoveOrphansImages,
  scanRemoveOrphansIcons,
  SKIP_VIDEO ? (d) => d() : scanRemoveOrphansVideo
);
exports.orphans = orphans;

/* ─────────────── Public tasks ─────────────── */
// dev-пайплайн с флагами --skip-media / --only-media + опциональная очистка + .nojekyll + orphans
const buildBoth = gulp.series(
  NO_CLEAN ? noop : gulp.series(cleanDist, cleanBuild),
  gulp.parallel(ONLY_MEDIA ? noop : codeDist, SKIP_MEDIA ? noop : mediaDist),
  gulp.parallel(ONLY_MEDIA ? noop : codeBuild, SKIP_MEDIA ? noop : mediaBuildCopy),
  pagesNoJekyll,
  orphans,
  gulp.parallel(pruneDistEmpty, pruneBuildEmpty)
);

const start = gulp.series(buildBoth, gulp.parallel(watchCode, watchMedia));

const buildDist = gulp.series(NO_CLEAN ? noop : cleanDist, codeDist, pruneDistEmpty);
const build = gulp.series(NO_CLEAN ? noop : cleanBuild, codeBuild, pagesNoJekyll, pruneBuildEmpty);

exports.dev = buildBoth;        // npm run dev
exports.start = start;          // npm run watch (если добавишь скрипт)
exports['build:dist'] = buildDist;
exports.build = build;

// атомарные задачи
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
exports.faviconSvgToIcoDist = faviconSvgToIcoDist;
exports.videoDist = videoDist;
exports.mediaBuildCopy = mediaBuildCopy;

exports.seoDist = seoDist;
exports.seoBuild = seoBuild;

exports.pagesNoJekyll = pagesNoJekyll;
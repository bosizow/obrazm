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
const VIDEO_SCALED_ONLY = true; // генерим только уменьшенные версии

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
    dir: 'src/css',
    src: 'src/css/**/*.scss',
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

// Медиа
const ASSETS = {
  images: {
    src: 'src/assets/images/**/*.{jpg,jpeg,png,gif,svg,webp,avif}',
    dist: 'dist/assets/images',
    build: 'build/assets/images',
  },
  // «обычные» иконки проекта (не фавиконки)
  icons: {
    src: 'src/assets/icons/**/*.{svg,png,ico}',
    dist: 'dist/assets/icons',
    build: 'build/assets/icons',
  },
  // НОВОЕ: каталог фавиконок и манифеста
  favicons: {
    images: {
      src: 'src/assets/favicons/**/*.{svg,png,ico}',
      dist: 'dist/assets/favicons',
      build: 'build/assets/favicons',
    },
    manifest: {
      // копируем как есть
      src: [
        'src/assets/favicons/*.webmanifest',
        'src/assets/favicons/manifest*.json',
      ],
    },
    // исходный svg для генерации набора иконок
    faviconSvg: 'src/assets/favicons/favicon.svg',
  },
  video: {
    src: 'src/assets/video/**/*.mp4',
    dist: 'dist/assets/video',
    build: 'build/assets/video',
    posterExt: '.jpg',
  },
  seo: {
    src: ['src/robots.txt', 'src/sitemap.xml'],
    dist: 'dist',
    build: 'build',
  },
};

/* ───────────────── helpers ───────────────── */
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function warnMissing(what, where) { log(c.yellow(`⚠ ${what} не найдено в ${where}. Пропускаю задачу.`)); }
function rmDirSafe(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); log(c.gray(`clean: ${dir} removed`)); } catch (e) { log(c.red(`clean error for ${dir}: ${e.message}`)); } }
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
  if (i > -1) return g.slice(0, i).replace(/[\\/]+$/, '');
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

/* ─────────────── Images ─────────────── */
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
          ]
        }),
      ], { verbose: true }))
      .pipe(gulp.dest(ASSETS.images.dist));
    return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  });
}

/* ─────────────── Icons (обычные, не фавиконы) ─────────────── */
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
          ]
        }),
      ], { verbose: true }))
      .pipe(gulp.dest(ASSETS.icons.dist));
    return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  });
}

/* ─────────────── Favicons (НОВОЕ) ─────────────── */
/** Сжатие png/svg/ico в src/assets/favicons → dist/assets/favicons */
function faviconsImagesDist() {
  if (!exists('src/assets/favicons')) warnMissing('Папка src/assets/favicons', process.cwd());
  return Promise.all([
    import('gulp-imagemin'),
    import('imagemin-pngquant'),
    import('imagemin-svgo'),
  ]).then(([{ default: imagemin }, { default: pngquant }, { default: svgo }]) => {
    const stream = srcChecked(ASSETS.favicons.images.src, { base: 'src/assets/favicons' })
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(newer(ASSETS.favicons.images.dist))
      .pipe(imagemin([
        pngquant({ quality: [0.7, 0.9], speed: 3 }),
        svgo({
          plugins: [
            { name: 'preset-default', params: { overrides: { removeViewBox: false, convertShapeToPath: false } } },
            { name: 'sortAttrs' },
          ]
        }),
      ], { verbose: true }))
      .pipe(gulp.dest(ASSETS.favicons.images.dist));
    return new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  });
}

/** Копирование манифеста(ов) как есть */
function faviconsManifestDist() {
  return srcChecked(ASSETS.favicons.manifest.src, { base: 'src/assets/favicons', allowEmpty: true })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(newer(ASSETS.favicons.images.dist))
    .pipe(gulp.dest(ASSETS.favicons.images.dist));
}

/** Генерация favicon-16.png, favicon-32.png, favicon.ico из favicon.svg */
async function faviconsGenerateFromSvgDist(done) {
  try {
    const svgPath = ASSETS.favicons.faviconSvg;
    if (!exists(svgPath)) {
      warnMissing('favicon.svg', 'src/assets/favicons');
      return done();
    }
    const distDir = ASSETS.favicons.images.dist;
    ensureDirSync(distDir);

    const svgBuf = fs.readFileSync(svgPath);
    // генерим png 16 и 32
    const targets = [
      { name: 'favicon-16.png', size: 16 },
      { name: 'favicon-32.png', size: 32 },
    ];
    for (const t of targets) {
      const out = path.join(distDir, t.name);
      const png = await sharp(svgBuf, { density: 256 }).resize(t.size, t.size).png().toBuffer();
      fs.writeFileSync(out, png);
      log(c.gray(`favicons: created ${path.relative(process.cwd(), out)}`));
    }
    // .ico (16,32)
    const icoBuf = await toIco([
      await sharp(svgBuf, { density: 256 }).resize(16, 16).png().toBuffer(),
      await sharp(svgBuf, { density: 256 }).resize(32, 32).png().toBuffer(),
    ]);
    const icoOut = path.join(distDir, 'favicon.ico');
    fs.writeFileSync(icoOut, icoBuf);
    log(c.gray(`favicons: created ${path.relative(process.cwd(), icoOut)}`));

    // скопируем исходный favicon.svg (если не попал через faviconsImagesDist)
    const svgOut = path.join(distDir, 'favicon.svg');
    if (!exists(svgOut)) {
      fs.copyFileSync(svgPath, svgOut);
      log(c.gray(`favicons: copied favicon.svg → ${path.relative(process.cwd(), svgOut)}`));
    }

    done();
  } catch (e) {
    log(c.red(`favicons: ошибка генерации — ${e.message}`));
  }
}

/* ─────────────── Копирование media из dist → build ─────────────── */
function mediaBuildCopy() {
  return gulp.src(['dist/assets/**/*'], { base: 'dist' })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(gulp.dest('build'));
}

/* ─────────────── SEO files: robots.txt & sitemap.xml ─────────────── */
function seoDist() {
  return srcChecked(ASSETS.seo.src, { base: 'src', allowEmpty: true })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(newer(paths.dist))
    .pipe(gulp.dest(paths.dist));
}
function seoBuild() {
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
    .pipe(fileinclude({ prefix: '@@', basepath: '@file', context: { SITE } }))
    .pipe(gulp.dest(paths.html.dist));
}
function htmlBuild() {
  if (!exists(paths.src)) warnMissing('Папка src', process.cwd());
  const SITE = loadSiteJson();
  let stream = srcChecked(paths.html.src, { base: paths.src })
    .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
    .pipe(fileinclude({ prefix: '@@', basepath: '@file', context: { SITE } }));

  if (USE_MIN_SUFFIX) {
    stream = stream
      .pipe(replace(/(href=["'][^"']*?vendor\/normalize)\.css(["'])/g, '$1.min.css$2'))
      .pipe(replace(/(href=["'][^"']*?\/css\/[^"']+?)\.css(["'])/g, '$1.min.css$2'))
      .pipe(replace(/(src=["'][^"']*?\/js\/[^"']+?)\.js(["'])/g, '$1.min.js$2'));
  }

  return stream
    .pipe(htmlmin({ collapseWhitespace: true, removeComments: true, minifyCSS: false, minifyJS: false }))
    .pipe(gulp.dest(paths.html.build));
}

/* ─────────────── Styles (SCSS→CSS) ─────────────── */
function stylesDist() {
  if (!exists(paths.styles.dir)) warnMissing('Папка src/css', process.cwd());
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
  if (!exists(paths.styles.dir)) warnMissing('Папка src/css', process.cwd());
  return import('cssnano').then(({ default: cssnano }) => {
    let stream = srcChecked(paths.styles.entries, { base: paths.styles.dir })
      .pipe(plumber({ errorHandler: (err) => log(c.red(err.message)) }))
      .pipe(sass({ outputStyle: 'expanded' }))
      .pipe(postcss([autoprefixer()]))
      .pipe(gcmq())
      .pipe(postcss([cssnano()]));
    if (USE_MIN_SUFFIX) stream = stream.pipe(rename({ suffix: '.min' }));
    stream = stream.pipe(gulp.dest(paths.styles.build));
    return new Promise((resolve, reject) => { stream.on('end', resolve).on('error', reject); });
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
    let normalize = srcChecked(paths.vendor.normalize, { allowEmpty: true }).pipe(postcss([cssnano()]));
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
function runFfmpeg(cmd) { return new Promise((resolve, reject) => { cmd.on('end', resolve).on('error', reject).run(); }); }

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
      ffmpeg(absIn).noAudio().videoCodec('libx264').videoFilters(scaleFilter)
        .outputOptions(['-crf 27', '-preset medium', '-movflags +faststart']).output(outMp4).outputOptions(['-y'])
    );
    log(c.gray(`video: mp4 (scaled ${Math.round(VIDEO_SCALE * 100)}%) ${rel} → ${path.relative(process.cwd(), outMp4)}`));
  } catch (e) { log(c.yellow(`video: mp4 пропущен (${rel}) — ${e.message}`)); }

  // webm (scaled, mute)
  try {
    await runFfmpeg(
      ffmpeg(absIn).noAudio().videoCodec('libvpx-vp9').videoFilters(scaleFilter)
        .outputOptions(['-b:v 0', '-crf 32']).output(outWebm).outputOptions(['-y'])
    );
    log(c.gray(`video: webm (scaled ${Math.round(VIDEO_SCALE * 100)}%) ${rel} → ${path.relative(process.cwd(), outWebm)}`));
  } catch (e) { log(c.yellow(`video: webm пропущен (${rel}) — ${e.message}`)); }

  // постер (первый кадр)
  try {
    await runFfmpeg(ffmpeg(absIn).frames(1).outputOptions(['-q:v 2']).output(outPoster).outputOptions(['-y']));
    log(c.gray(`video: poster ${rel} → ${path.relative(process.cwd(), outPoster)}`));
  } catch (e) { log(c.yellow(`video: poster пропущен (${rel}) — ${e.message}`)); }
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
  faviconsImagesDist,
  faviconsManifestDist,
  faviconsGenerateFromSvgDist,
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
  gulp.watch(ASSETS.seo.src, gulp.series(seoDist, seoBuild, pruneDistEmpty, pruneBuildEmpty));
}
function watchMedia() {
  gulp.watch(ASSETS.images.src, gulp.series(imagesDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch(ASSETS.icons.src, gulp.series(iconsDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty));
  gulp.watch([...ASSETS.favicons.manifest.src, ASSETS.favicons.images.src],
    gulp.series(faviconsImagesDist, faviconsManifestDist, faviconsGenerateFromSvgDist, mediaBuildCopy, pruneDistEmpty, pruneBuildEmpty)
  );
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
function scanRemoveOrphansFavicons() {
  const distRoot = ASSETS.favicons.images.dist;
  if (!exists(distRoot)) return Promise.resolve();

  const baseImages = baseDirFromGlob(ASSETS.favicons.images.src) || 'src/assets/favicons';
  const imgSrcSet = new Set(fg.sync(ASSETS.favicons.images.src, { onlyFiles: true }).map(p => path.resolve(p)));
  const manSrcSet = new Set(fg.sync(ASSETS.favicons.manifest.src, { onlyFiles: true }).map(p => path.resolve(p)));

  // Дополнительно — разрешённые сгенерированные файлы
  const generatedKeeps = new Set();
  if (exists(ASSETS.favicons.faviconSvg)) {
    ['favicon-16.png', 'favicon-32.png', 'favicon.ico', 'favicon.svg'].forEach((n) => {
      generatedKeeps.add(path.resolve(path.join(distRoot, n)));
    });
  }

  const files = fg.sync(path.join(distRoot, '**/*'), { onlyFiles: true });
  for (const f of files) {
    if (generatedKeeps.has(path.resolve(f))) continue;
    const rel = path.relative(distRoot, f);
    const candidateImg = path.resolve(path.join(baseImages, rel));
    const candidateMan = path.resolve(path.join(baseImages, rel));
    if (!imgSrcSet.has(candidateImg) && !manSrcSet.has(candidateMan)) {
      log(c.gray(`orphans(favicons): remove ${path.relative(process.cwd(), f)}`));
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
  scanRemoveOrphansFavicons,
  SKIP_VIDEO ? (d) => d() : scanRemoveOrphansVideo
);
exports.orphans = orphans;

/* ─────────────── Public tasks ─────────────── */
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

exports.dev = buildBoth;
exports.start = start;
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

exports.faviconsImagesDist = faviconsImagesDist;
exports.faviconsManifestDist = faviconsManifestDist;
exports.faviconsGenerateFromSvgDist = faviconsGenerateFromSvgDist;

exports.videoDist = videoDist;
exports.mediaBuildCopy = mediaBuildCopy;

exports.seoDist = seoDist;
exports.seoBuild = seoBuild;

exports.pagesNoJekyll = pagesNoJekyll;
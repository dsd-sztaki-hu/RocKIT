'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const assetsRoot = __dirname;
const host = '127.0.0.1';
const port = Number(process.env.ROCKIT_README_PREVIEW_PORT || 58040);
const MarkdownIt = require(require.resolve('markdown-it', { paths: [repoRoot] }));
const markdown = new MarkdownIt({ html: true, linkify: true, typographer: false });

const imageTypes = new Map([
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function renderPage() {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const body = markdown.render(readme);

  return '<!doctype html>\n' +
    '<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>RocKIT README preview</title>\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\'; base-uri \'none\'; form-action \'none\'">\n' +
    '<style>\n' +
    '* { box-sizing: border-box; }\n' +
    'body { margin: 0; padding: 28px 18px 60px; background: #f5f7f8; color: #19384a; font: 16px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\n' +
    '#readme { max-width: 980px; margin: 0 auto; padding: 42px 54px; border: 1px solid #e0e6e9; border-radius: 10px; background: #fff; box-shadow: 0 8px 30px rgb(18 49 67 / 7%); overflow-wrap: anywhere; }\n' +
    '#readme > p:first-child, #readme > h1:first-of-type, #readme > h1:first-of-type + p, #readme > h1:first-of-type + p + p, #readme > h1:first-of-type + p + p + p { text-align: center; }\n' +
    '#readme > p:first-child img { display: inline-block; width: min(480px, 90%); height: auto; }\n' +
    '#readme img { max-width: 100%; height: auto; }\n' +
    '#readme h1, #readme h2, #readme h3 { line-height: 1.3; font-weight: 600; }\n' +
    '#readme h1 { margin: 12px 0 16px; font-size: 2rem; }\n' +
    '#readme h2 { margin: 34px 0 16px; padding-bottom: 7px; border-bottom: 1px solid #d9e3e8; font-size: 1.5rem; }\n' +
    '#readme h3 { margin: 26px 0 12px; font-size: 1.2rem; }\n' +
    '#readme p, #readme ul, #readme ol { margin: 0 0 16px; }\n' +
    '#readme a { color: #075ca8; }\n' +
    '#readme pre { overflow-x: auto; padding: 14px 16px; border-radius: 7px; background: #f1f4f6; }\n' +
    '#readme code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }\n' +
    '#readme pre code { font-size: .92em; }\n' +
    '@media (max-width: 680px) { body { padding: 0; } #readme { padding: 28px 20px; border: 0; border-radius: 0; box-shadow: none; } #readme h1 { font-size: 1.7rem; } }\n' +
    '</style>\n</head>\n' +
    '<body><main id="readme">' + body + '</main></body>\n</html>';
}

function notFound(response) {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('not found');
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://' + host).pathname;

  if (request.method !== 'GET') {
    notFound(response);
    return;
  }

  if (pathname === '/') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(renderPage());
    return;
  }

  const assetPrefix = '/readme-assets/';
  if (!pathname.startsWith(assetPrefix)) {
    notFound(response);
    return;
  }

  const filename = pathname.slice(assetPrefix.length);
  const contentType = imageTypes.get(path.extname(filename).toLowerCase());
  if (!filename || path.basename(filename) !== filename || !contentType) {
    notFound(response);
    return;
  }

  const assetPath = path.join(assetsRoot, filename);
  let stats;
  try {
    stats = fs.statSync(assetPath);
  } catch {
    notFound(response);
    return;
  }
  if (!stats.isFile()) {
    notFound(response);
    return;
  }

  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(assetPath).pipe(response);
});

server.listen(port, host, () => {
  console.log('RocKIT README preview: http://' + host + ':' + port + '/');
});

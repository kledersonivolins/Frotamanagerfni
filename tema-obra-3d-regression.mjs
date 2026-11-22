import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// login continua com tudo que o fluxo de entrada usa
for (const id of ['loginScreen', 'loginForm', 'loginUser', 'loginPass', 'lgpd_check', 'lgpd_box', 'loginSubmitBtn', 'loginSubmitLabel', 'loginSubmitIcon']) {
  assert.ok(html.includes(`id="${id}"`), `login perdeu o elemento #${id}`);
}
assert.ok(html.includes('<canvas id="loginCena" aria-hidden="true"></canvas>'), 'falta o canvas da cena 3D');

// camada visual vem depois de todos os outros temas (é a que vale)
const pos = (s) => html.indexOf(s);
assert.ok(pos('<style id="theme-obra-3d">') > pos('<style id="theme-industrial-grafite-final">'));
assert.ok(pos('<style id="theme-obra-3d">') < pos('</head>'));

// three.js só é baixado quando o login aparece, de versão fixa no cdnjs
const js = html.slice(pos('<script id="obra-3d-js">'));
assert.match(js, /cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/);
assert.ok(!/<script[^>]+src="[^"]*three/.test(html), 'three.js não deve carregar sempre');
assert.match(js, /prefers-reduced-motion/);

console.log('tema-obra-3d OK');

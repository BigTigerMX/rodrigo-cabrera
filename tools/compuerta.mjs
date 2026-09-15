/* =========================================================
   COMPUERTA DE VERIFICACIÓN — rodrigo-cabrera
   ---------------------------------------------------------
   No hay tests unitarios: lo que se verifica es la PÁGINA
   RENDERIZADA. Se mide el DOM y los píxeles reales a tres
   anchos (390 / 768 / 1440).

   Uso:
     node tools/compuerta.mjs [url] [--fotos]

   Trampas que costaron tiempo y por eso están resueltas aquí:
   1) Medir en la capa equivocada. Un título "cortado" no se ve
      en el HTML ni en el CSS: se ve en los rectángulos que el
      navegador le da al texto. Por eso el corte de palabra se
      mide con Range.getClientRects(), no contando caracteres.
   2) page.goto() a la MISMA url cambiando sólo el '#' NO recarga
      (es navegación dentro del documento), así que un fallo del
      arranque jamás aparecería. Cada comprobación abre pestaña
      nueva y añade un parámetro ?c= distinto para forzar carga.
   ========================================================= */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

/* Playwright puede estar instalado global (así viene en este entorno) y
   `import` de ESM no mira NODE_PATH: hay que resolverlo con require. */
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  const raiz = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = require(`${raiz}/playwright`));
}

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:8099/index.html';
const CON_FOTOS = process.argv.includes('--fotos');
const SALIDA = 'tools/capturas';

const ANCHOS = [
  { nombre: 'movil', width: 390, height: 844 },
  { nombre: 'tablet', width: 768, height: 1024 },
  { nombre: 'escritorio', width: 1440, height: 900 },
];

const fallos = [];
const avisos = [];
let nContador = 0;
const falla = (donde, msg) => fallos.push(`[${donde}] ${msg}`);
const avisa = (donde, msg) => avisos.push(`[${donde}] ${msg}`);

/* Pestaña nueva + url única: ver trampa (2) del encabezado. */
async function abrir(ctx, viewport) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const errores = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  await page.goto(`${BASE}?c=${Date.now()}-${nContador++}`, { waitUntil: 'load' });
  // el loader se quita solo; 2.6 s es su failsafe
  await page.waitForFunction(() => !document.body.classList.contains('loading'), null, { timeout: 8000 }).catch(() => {});
  // margen para que la entrada del hero termine (clip-path 1.1 s + 0.35 s de
  // retardo): medir a media transición da falsos positivos
  await page.waitForTimeout(1800);
  return { page, errores };
}

/* --------- comprobación 1: un solo h1 --------- */
async function unSoloH1(page, donde) {
  const n = await page.locator('h1').count();
  if (n !== 1) falla(donde, `hay ${n} elementos <h1>; debe haber exactamente 1`);
}

/* --------- comprobación 2: nada se desborda de lado --------- */
async function sinDesborde(page, donde) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const culpables = [], tolerados = [];
    const nombre = (el) => `${el.tagName.toLowerCase()}${el.className && el.className.baseVal === undefined ? '.' + String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.') : ''}`;
    // ¿Algún antepasado lo recorta? Ésa es la forma legítima de sangrar
    // fuera de pantalla (el plano de fondo, la marquesina, el carril de obra
    // viven dentro de contenedores con overflow oculto).
    const loRecortan = (el) => {
      let n = el.parentElement;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (/hidden|clip|auto|scroll/.test(cs.overflowX)) return true;
        n = n.parentElement;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.right <= vw + 1 && b.left >= -1) continue;
      const ficha = `${nombre(el)} (${Math.round(b.left)}→${Math.round(b.right)} de ${vw})`;
      if (loRecortan(el)) tolerados.push(ficha); else culpables.push(ficha);
    }
    return { doc: document.scrollingElement.scrollWidth, vw, culpables: culpables.slice(0, 8), tolerados: tolerados.length };
  });
  // OJO: html{overflow-x:hidden} deja scrollWidth pegado al ancho de la
  // ventana, así que un desborde real NO aparece ahí. Lo que delata el
  // defecto es el rectángulo de cada elemento contra la ventana.
  if (r.doc > r.vw + 1) falla(donde, `el documento se desborda: scrollWidth ${r.doc} > ancho ${r.vw}`);
  if (r.culpables.length) falla(donde, `se salen de pantalla sin que nadie los recorte: ${r.culpables.join(' · ')}`);
  if (r.tolerados) avisa(donde, `${r.tolerados} elemento(s) sangran fuera de pantalla, recortados por su contenedor (es intencional)`);
}

/* --------- comprobación 3: ninguna palabra partida a media palabra ---------
   Se mide con Range: si una palabra genera más de un rectángulo, el
   navegador la partió en dos renglones. Es la capa correcta. */
async function palabrasEnteras(page, donde, selector) {
  const r = await page.evaluate((sel) => {
    const salida = [];
    for (const nodo of document.querySelectorAll(sel)) {
      const texto = nodo.textContent.replace(/\s+/g, ' ').trim();
      if (!texto) continue;
      const rangos = [];
      // cada palabra por separado, saltando nodos de texto vacíos
      const walker = document.createTreeWalker(nodo, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.textContent;
        let i = 0;
        while (i < t.length) {
          while (i < t.length && /\s/.test(t[i])) i++;
          const ini = i;
          while (i < t.length && !/\s/.test(t[i])) i++;
          if (i > ini) {
            const rg = document.createRange();
            rg.setStart(n, ini); rg.setEnd(n, i);
            const cajas = [...rg.getClientRects()].filter((c) => c.width > 0.5 && c.height > 0.5);
            // una palabra entera vive en UN renglón: todas sus cajas
            // comparten la misma línea base (mismo top, ±2px)
            const tops = new Set(cajas.map((c) => Math.round(c.top / 2)));
            if (tops.size > 1) rangos.push(t.slice(ini, i));
          }
        }
      }
      if (rangos.length) salida.push({ texto: texto.slice(0, 40), partidas: rangos });
    }
    return salida;
  }, selector);
  for (const x of r) falla(donde, `"${x.texto}" se parte a media palabra: ${x.partidas.join(', ')}`);
}

/* --------- comprobación 3 bis: el titular, un renglón por palabra ---------
   OJO: el main.js parte el h1 en un <span> por LETRA. Por eso la
   comprobación de palabras enteras (Range) no ve nada aquí: cada rango
   cubre una sola letra y nunca cruza dos renglones. Es la trampa de medir
   en la capa equivocada. Lo que hay que medir es a qué altura quedó cada
   letra: si las letras de una misma línea tienen dos alturas distintas,
   la palabra se partió (CABRER / A). */
async function titularEnUnRenglon(page, donde) {
  const r = await page.evaluate(() => {
    const out = [];
    for (const ln of document.querySelectorAll('.hero h1 .ln')) {
      const letras = ln.querySelectorAll('.ch');
      // offsetTop, no getBoundingClientRect: las letras entran animadas con
      // translateY escalonado, así que sus rectángulos están a alturas
      // distintas mientras dura la entrada y la comprobación daría un falso
      // positivo. offsetTop es posición de MAQUETA, ajena al transform.
      const alturas = new Set([...(letras.length ? letras : [ln])]
        .filter((e) => e.offsetWidth > 0)
        .map((e) => Math.round(e.offsetTop / 3)));
      if (alturas.size > 1) out.push({ t: ln.textContent.trim(), n: alturas.size });
    }
    return out;
  });
  for (const x of r) falla(donde, `"${x.t}" se parte en ${x.n} renglones; cada renglón debe ser una palabra completa`);
}

/* --------- comprobación 4: texto sin recortar --------- */
async function sinRecorte(page, donde, selector) {
  const r = await page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.scrollWidth > el.clientWidth + 1) out.push({ t: el.textContent.trim().slice(0, 30), s: el.scrollWidth, c: el.clientWidth });
    }
    return out;
  }, selector);
  for (const x of r) falla(donde, `"${x.t}" está recortado (${x.s}px de contenido en ${x.c}px)`);
}

/* --------- comprobación 5: contraste del texto sobre su fondo --------- */
async function contraste(page, donde) {
  const r = await page.evaluate(() => {
    const lum = (c) => {
      const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const fondoDe = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        const c = rgb(cs.backgroundColor);
        const a = Number((cs.backgroundColor.match(/[\d.]+/g) || [])[3] ?? 1);
        if (c.length === 3 && a > 0.6) return c;
        n = n.parentElement;
      }
      return [12, 17, 22]; // --night
    };
    const out = [];
    const sel = 'p, li, .hero__tag, .biglink b, .biglink small, .wpanel__info h3, .wpanel__info span, .cf-note, .footer p, .ficha__dato, .ficha__rot, .hoja__rot, .hoja__folio, .cajetin__datos dt, .cajetin__datos dd, .cajetin__nav a, .cajetin__arriba';
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.95) continue;
      const t = el.textContent.trim();
      if (!t) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      const f = rgb(cs.color);
      let g = fondoDe(el);
      // Detrás de TODO hay un plano azul animado. Un texto que pasa contra
      // el fondo base puede no pasar contra una línea del plano: si el
      // elemento vive sobre dos superficies, son dos medidas, no una.
      const plano = document.querySelector('.bg-plan svg');
      const sobreElPlano = plano && !el.closest('.works, .footer, .pano, .loader');
      if (sobreElPlano) {
        const a = Number(getComputedStyle(plano).opacity || 1);
        const linea = [93, 146, 189]; // --blue-line
        const mezcla = linea.map((c, i) => c * a + g[i] * (1 - a));
        if (lum(mezcla) > lum(g)) g = mezcla; // nos quedamos con el peor caso
      }
      const L1 = lum(f), L2 = lum(g);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      const minimo = grande ? 3 : 4.5;
      if (ratio < minimo) out.push({ t: t.slice(0, 32), ratio: ratio.toFixed(2), minimo, px: Math.round(px) });
    }
    return out.slice(0, 10);
  });
  for (const x of r) falla(donde, `contraste ${x.ratio}:1 (mínimo ${x.minimo}) en "${x.t}" a ${x.px}px`);
}

/* --------- comprobación 6: el retrato de portada va desaturado ---------
   Capa de PÍXELES: se recorta el retrato del screenshot y se mide la
   saturación media. Un retrato a color la dispara; uno en B/N no. */
async function retratoEnBN(page, donde) {
  const retrato = page.locator('.hero__retrato img, .hero__portrait img').first();
  if (!(await retrato.count())) { falla(donde, 'no se encontró el retrato de portada'); return; }
  // captura del ELEMENTO, no de un recorte de la ventana: si el retrato
  // quedó fuera de la pantalla, un clip fijo revienta en vez de medir
  await retrato.scrollIntoViewIfNeeded().catch(() => {});
  const buf = await retrato.screenshot();
  const sat = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let suma = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      suma += mx - mn; n++;
    }
    return suma / n;
  }, buf.toString('base64'));
  if (sat > 14) falla(donde, `el retrato de portada sale a color (saturación media ${sat.toFixed(1)}; máximo 14)`);
}

/* --------- comprobación 6 bis: el texto sobre la foto tiene suelo propio ---------
   La banda panorámica pone una cita ENCIMA de una fotografía. Medirlo con
   la foto de hoy es firmar un contrato con todas las fotos de mañana. Se
   mide en PÍXELES el fondo realmente pintado (capa + foto) en la franja
   lateral de la banda, que es fondo puro, y se exige contraste contra el
   color del texto. */
async function sueloBajoLaCita(page, donde) {
  const cita = page.locator('.pano__quote blockquote').first();
  if (!(await cita.count())) { avisa(donde, 'no hay banda panorámica que medir'); return; }
  await cita.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const caja = await page.locator('.pano').first().boundingBox();
  const color = await cita.evaluate((el) => getComputedStyle(el).color);
  const franja = {
    x: Math.round(caja.x + caja.width * 0.02),
    y: Math.round(Math.max(caja.y, 0) + 10),
    width: Math.max(8, Math.round(caja.width * 0.06)),
    height: Math.round(Math.min(caja.height - 20, 400)),
  };
  const buf = await page.screenshot({ clip: franja });
  const peor = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const lum = (r, g, b) => {
      const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = lum(d[i], d[i + 1], d[i + 2]);
      if (L > max) max = L;
    }
    return max;
  }, buf.toString('base64'));
  const [r, g, b] = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const Ltxt = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  const ratio = (Math.max(Ltxt, peor) + 0.05) / (Math.min(Ltxt, peor) + 0.05);
  // la cita es texto grande: el mínimo es 3:1, pero se pide 4.5 de margen
  // porque la foto que irá ahí mañana puede ser más clara que ésta
  if (ratio < 4.5) falla(donde, `la cita sobre la foto queda a ${ratio.toFixed(2)}:1 contra el punto más claro de su fondo (mínimo 4.5 para que aguante otra foto)`);
}

/* --------- comprobación 7: aire muerto antes de "Obra selecta" --------- */
async function sinAireMuerto(page, donde) {
  const hueco = await page.evaluate(() => {
    const previo = document.querySelector('#vision');
    const obra = document.querySelector('#obra');
    if (!previo || !obra) return null;
    // de TINTA a TINTA: el borde de la sección no se ve; lo que el ojo mide
    // es la última cosa dibujada contra la primera de la sección siguiente
    const tinta = previo.querySelector('.dimline') || previo;
    const finPrevio = tinta.getBoundingClientRect().bottom + window.scrollY;
    // primer contenido visible de la sección de obra (no el contenedor)
    // la primera tinta VISIBLE: un elemento con display:none devuelve un
    // rectángulo en (0,0) y haría pasar la comprobación con el defecto puesto
    const visible = (el) => el && el.getClientRects().length > 0;
    const intro = [obra.querySelector('.works__cab'), obra.querySelector('.wpanel--intro')].find(visible);
    if (!intro) return null;
    const y = window.scrollY;
    // scroll-behavior:smooth convierte scrollTo en una animación: sin esto
    // se mide ANTES de llegar y el número no significa nada
    const previoComportamiento = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.max(obra.getBoundingClientRect().top + y - 1, 0));
    const inicio = intro.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, y);
    document.documentElement.style.scrollBehavior = previoComportamiento;
    return Math.round(inicio - finPrevio);
  });
  if (hueco === null) { avisa(donde, 'no se pudo medir el hueco previo a Obra'); return; }
  avisa(donde, `hueco entre la última cota de Visión y la cabecera de Obra: ${hueco}px`);
  if (hueco > 260) falla(donde, `hueco de ${hueco}px de aire muerto antes de "Obra selecta" (máximo 260)`);
}

/* --------- comprobación 7 bis: los enlaces internos llegan a algún lado ---------
   Un ancla rota no se ve nunca en una captura: la página simplemente no se
   mueve. Se comprueba contra el DOM, que es donde vive la verdad. */
async function anclasVivas(page, donde) {
  const rotas = await page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const id = a.getAttribute('href').slice(1);
      if (!id) continue;
      if (!document.getElementById(id)) out.push(`${a.textContent.trim().slice(0, 24)} → #${id}`);
    }
    return out;
  });
  for (const r of rotas) falla(donde, `enlace interno roto: ${r}`);
}

/* --------- comprobación 7 ter: el formulario se comporta ---------
   Que el formulario EXISTA no dice nada. Lo que hay que probar es lo que
   hace: que no recargue la página, que avise qué falta, que marque el campo
   culpable y que diga algo distinto cuando el envío sale bien y cuando
   falla. La red se intercepta: no se le pega al servicio real desde una
   comprobación. */
async function formularioSeComporta(page, donde) {
  const form = page.locator('.contact__form');
  if (!(await form.count())) { falla(donde, 'no hay formulario de contacto'); return; }

  let peticiones = 0;
  await page.route('**/formsubmit.co/**', async (ruta) => {
    peticiones++;
    await ruta.fulfill({ status: 200, contentType: 'application/json', body: '{"success":"true"}' });
  });

  const urlAntes = page.url();
  await form.scrollIntoViewIfNeeded();

  // 1) vacío: ni se envía ni se recarga, y dice qué falta
  await page.locator('.contact__form button[type="submit"]').click();
  await page.waitForTimeout(350);
  if (page.url() !== urlAntes) { falla(donde, 'el formulario vacío recarga la página en vez de avisar'); return; }
  let aviso = (await page.locator('.cf-note').textContent()).trim();
  if (!aviso) falla(donde, 'el formulario vacío no dice nada: se envía al vacío o falla en silencio');
  const marcados = await page.locator('.cf-field.cf-mal').count();
  if (!marcados) falla(donde, 'el formulario vacío no marca qué campo falta');
  const enfocado = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (enfocado !== 'c-n') falla(donde, `el foco no salta al primer campo que falta (quedó en "${enfocado}")`);
  if (peticiones) falla(donde, 'se envió una petición con el formulario vacío');

  // 2) correo mal escrito: mensaje distinto, tampoco se envía
  await page.fill('#c-n', 'Prueba Compuerta');
  await page.fill('#c-e', 'esto-no-es-un-correo');
  await page.fill('#c-m', 'Mensaje de prueba de la compuerta.');
  await page.locator('.contact__form button[type="submit"]').click();
  await page.waitForTimeout(350);
  const avisoCorreo = (await page.locator('.cf-note').textContent()).trim();
  if (!/correo/i.test(avisoCorreo)) falla(donde, `con un correo inválido el aviso no lo menciona: "${avisoCorreo}"`);
  if (peticiones) falla(donde, 'se envió una petición con un correo inválido');

  // 3) bien llenado: sale la petición, avisa que llegó y limpia
  await page.fill('#c-e', 'cliente@ejemplo.com');
  await page.locator('.contact__form button[type="submit"]').click();
  await page.waitForTimeout(900);
  if (!peticiones) falla(donde, 'con el formulario bien llenado no se envió nada');
  aviso = (await page.locator('.cf-note').textContent()).trim();
  const claseAviso = await page.locator('.cf-note').getAttribute('class');
  if (!aviso || !/ok/.test(claseAviso || '')) falla(donde, `tras un envío correcto no se confirma nada (aviso: "${aviso}")`);
  if ((await page.inputValue('#c-n')) !== '') falla(donde, 'tras enviar, el formulario conserva lo escrito');

  // 4) si el servicio falla, el usuario se entera y le queda una salida
  await page.unroute('**/formsubmit.co/**');
  await page.route('**/formsubmit.co/**', (ruta) => ruta.fulfill({ status: 500, contentType: 'application/json', body: '{"success":"false"}' }));
  await page.fill('#c-n', 'Prueba Compuerta');
  await page.fill('#c-e', 'cliente@ejemplo.com');
  await page.fill('#c-m', 'Segundo mensaje.');
  await page.locator('.contact__form button[type="submit"]').click();
  await page.waitForTimeout(900);
  const avisoError = (await page.locator('.cf-note').textContent()).trim();
  const claseError = await page.locator('.cf-note').getAttribute('class');
  if (!/error/.test(claseError || '')) falla(donde, `cuando el envío falla no se avisa como error (aviso: "${avisoError}")`);
  if (!/arquitecto@rodrigo-cabrera\.com/.test(avisoError)) {
    falla(donde, `el aviso de error no ofrece la dirección pública del arquitecto como salida (dice: "${avisoError}")`);
  }
  for (const patron of CORREOS_INTERNOS) {
    if (patron.test(avisoError)) falla(donde, `el aviso de error muestra una dirección interna: "${avisoError}"`);
  }
  const btn = page.locator('.contact__form button[type="submit"]');
  if (await btn.isDisabled()) falla(donde, 'tras un envío fallido el botón se queda bloqueado');
  // Lo que más duele de un formulario: escribir un párrafo, fallar el envío
  // y encontrarlo vacío. Si falla, lo escrito se queda donde está.
  if ((await page.inputValue('#c-n')) !== 'Prueba Compuerta' || (await page.inputValue('#c-m')) !== 'Segundo mensaje.') {
    falla(donde, 'tras un envío fallido el formulario borró lo que la persona había escrito');
  }
  // El envío sin JavaScript manda el formulario de verdad: sin _next, quien
  // no tenga JS termina en la página genérica del servicio de correo.
  const ajustes = await page.evaluate(() => {
    const f = document.querySelector('.contact__form');
    const v = (n) => { const e = f.querySelector(`[name="${n}"]`); return e ? e.value : null; };
    return { next: v('_next'), captcha: v('_captcha'), accion: f.getAttribute('action') };
  });
  if (!ajustes.next || !/^https?:\/\//.test(ajustes.next)) falla(donde, 'el formulario sin JavaScript no tiene _next: el visitante acaba en la página del servicio de correo');
  if (ajustes.captcha !== 'false') falla(donde, `_captcha del envío sin JavaScript vale "${ajustes.captcha}" y no coincide con el envío por JS`);
  await page.unroute('**/formsubmit.co/**');
}

/* --------- comprobación 7 quater: ninguna dirección interna a la vista ---------
   La página es de Rodrigo y sus clientes le escriben a él. Una dirección
   nuestra cableada en la página pública de un cliente es un fallo, aunque
   sea cómoda: se revisa el texto Y los atributos, porque un mailto no se
   lee en la pantalla pero se ve al pasar el ratón y al copiar el enlace. */
const CORREOS_INTERNOS = [/luis\.santi\.tiger@gmail\.com/i, /@gmail\.com/i, /@hotmail\.com/i];
async function sinCorreosInternos(page, donde) {
  const encontrados = await page.evaluate(() => {
    const trozos = [document.body.innerText];
    for (const el of document.querySelectorAll('[href],[action],[data-title],[alt]')) {
      for (const attr of ['href', 'action', 'data-title', 'alt']) {
        const v = el.getAttribute(attr);
        if (v) trozos.push(v);
      }
    }
    return trozos.join(' \n ');
  });
  for (const patron of CORREOS_INTERNOS) {
    const hallazgo = encontrados.match(patron);
    if (hallazgo) falla(donde, `dirección interna a la vista del visitante: ${hallazgo[0]}`);
  }
}

/* --------- comprobación 7 quinquies: se puede LLEGAR a toda la obra ---------
   La galería tiene dos mecanismos: carril horizontal en escritorio y pila
   en el teléfono. Comprobar el mecanismo sería comprobar el CÓMO; lo que le
   importa al visitante es poder llegar a la última obra. Así que se recorre
   la sección de arriba abajo y se anota qué obras llegaron a verse. */
async function galeriaCompleta(page, donde) {
  const total = await page.locator('.wpanel__media').count();
  if (!total) { falla(donde, 'no hay obras en la galería'); return; }
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  const tramo = await page.evaluate(() => {
    const s = document.querySelector('.works');
    return { top: s.getBoundingClientRect().top + window.scrollY, alto: s.offsetHeight };
  });
  const vistas = new Set();
  const pasos = 24;
  for (let i = 0; i <= pasos; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), tramo.top + (tramo.alto * i) / pasos - 100);
    await page.waitForTimeout(120);
    const enPantalla = await page.evaluate(() => {
      const out = [];
      const vw = window.innerWidth, vh = window.innerHeight;
      document.querySelectorAll('.wpanel__media').forEach((el, i) => {
        const b = el.getBoundingClientRect();
        // se cuenta sólo si se ve un pedazo de verdad, no un píxel de borde
        const anchoVisible = Math.min(b.right, vw) - Math.max(b.left, 0);
        const altoVisible = Math.min(b.bottom, vh) - Math.max(b.top, 0);
        if (anchoVisible > b.width * 0.5 && altoVisible > b.height * 0.5) out.push(i);
      });
      return out;
    });
    enPantalla.forEach((n) => vistas.add(n));
    if (vistas.size === total) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  if (vistas.size < total) {
    const faltan = [];
    for (let i = 0; i < total; i++) if (!vistas.has(i)) faltan.push(i + 1);
    falla(donde, `recorriendo la sección de obra sólo se llega a ver ${vistas.size} de ${total} obras; no hay manera de llegar a la(s) ${faltan.join(', ')}`);
  }
}

/* --------- comprobación 8: sin backdrop-filter (regla de la casa) --------- */
async function sinBackdropFilter(page, donde) {
  const r = await page.evaluate(() => {
    let vivos = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none')) vivos++;
    }
    // Mirar sólo el estilo calculado deja pasar las reglas que dependen de
    // un estado (.site-header.scrolled sólo existe con la página bajada).
    // Por eso se leen además las reglas de la hoja.
    const reglas = [];
    for (const hoja of document.styleSheets) {
      let cr;
      try { cr = hoja.cssRules; } catch { continue; }
      // Primero las declaraciones y DESPUÉS las anidadas: desde que
      // Chromium soporta anidamiento, toda regla de estilo tiene un
      // cssRules (vacío), así que un "if (regla.cssRules) recurre; continue;"
      // se saltaba en silencio TODAS las declaraciones. Es exactamente el
      // caso de una comprobación que no comprueba nada.
      const recorre = (lista) => {
        for (const regla of lista) {
          if (regla.style && /backdrop-filter/i.test(regla.style.cssText || '')) {
            reglas.push(regla.selectorText || regla.cssText.slice(0, 40));
          }
          if (regla.cssRules && regla.cssRules.length) recorre(regla.cssRules);
        }
      };
      recorre(cr);
    }
    return { vivos, reglas };
  });
  if (r.vivos > 0) falla(donde, `${r.vivos} elemento(s) con backdrop-filter activo (prohibido: obliga a recomponer en cada cuadro de scroll)`);
  if (r.reglas.length) falla(donde, `reglas con backdrop-filter en la hoja de estilos: ${r.reglas.join(', ')}`);
}

/* --------- comprobación 9: reduced-motion apaga el movimiento, NO el JS --------- */
async function quietoSiguevivo(ctx, donde) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e)));
  await page.goto(`${BASE}?c=quieto-${Date.now()}`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const estado = await page.evaluate(() => ({
    anio: (document.querySelector('.year') || {}).textContent || '',
    loader: !!document.querySelector('.loader'),
    // el año lo escribe el paso 12 del main.js: si sigue vivo, todo lo
    // anterior también corrió (la trampa del `if (quieto) return;`)
    reveladas: document.querySelectorAll('.reveal.in').length,
    total: document.querySelectorAll('.reveal').length,
  }));
  if (estado.anio !== String(new Date().getFullYear())) falla(donde, 'con prefers-reduced-motion el JS se apaga antes de terminar (el año no se escribió)');
  if (estado.total && estado.reveladas < estado.total) falla(donde, `con prefers-reduced-motion quedaron ${estado.total - estado.reveladas} bloques sin revelar (contenido invisible)`);
  if (errores.length) falla(donde, `errores de JS en modo quieto: ${errores.join(' | ')}`);
  await page.close();
}

/* ========================= ejecución ========================= */
const navegador = await chromium.launch();
const ctx = await navegador.newContext({ deviceScaleFactor: 1 });
mkdirSync(SALIDA, { recursive: true });

for (const v of ANCHOS) {
  const donde = `${v.nombre} ${v.width}px`;
  const { page, errores } = await abrir(ctx, v);

  // una comprobación que revienta no puede llevarse por delante a las
  // demás: se apunta como fallo y se sigue
  const corre = async (nombre, fn) => {
    try { await fn(); } catch (e) { falla(donde, `la comprobación "${nombre}" reventó: ${String(e).split('\n')[0]}`); }
  };
  await corre('un solo h1', () => unSoloH1(page, donde));
  await corre('sin desborde', () => sinDesborde(page, donde));
  await corre('palabras enteras', () => palabrasEnteras(page, donde, 'h2, .hero__tag, .biglink b, .ficha__dato, .wpanel__info h3, .hoja__dato a, .cajetin__datos dd'));
  await corre('titular en un renglón', () => titularEnUnRenglon(page, donde));
  await corre('sin recorte', () => sinRecorte(page, donde, 'h1 .ln, .ficha__dato, .biglink b'));
  await corre('contraste', () => contraste(page, donde));
  await corre('retrato en B/N', () => retratoEnBN(page, donde));
  await corre('sin backdrop-filter', () => sinBackdropFilter(page, donde));
  await corre('suelo bajo la cita', () => sueloBajoLaCita(page, donde));
  await corre('anclas vivas', () => anclasVivas(page, donde));
  await corre('sin correos internos', () => sinCorreosInternos(page, donde));
  await corre('se llega a toda la obra', () => galeriaCompleta(page, donde));
  await corre('el formulario se comporta', () => formularioSeComporta(page, donde));
  await corre('sin aire muerto', () => sinAireMuerto(page, donde));

  // El 500 del paso 4 de la comprobación del formulario lo provoca ella
  // misma (respuesta simulada del servicio de correo): ese ruido es suyo,
  // no del sitio.
  const propios = errores.filter((e) => !/formsubmit\.co|status of 500/i.test(e));
  if (propios.length) falla(donde, `errores de consola: ${propios.slice(0, 4).join(' | ')}`);

  if (CON_FOTOS) {
    await page.screenshot({ path: `${SALIDA}/${v.nombre}-portada.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SALIDA}/${v.nombre}-completa.png`, fullPage: true });
  }
  await page.close();
}

await quietoSiguevivo(ctx, 'modo quieto');
await navegador.close();

const resumen = [
  fallos.length ? `\n✗ ${fallos.length} FALLO(S):\n` + fallos.map((f) => '  · ' + f).join('\n') : '\n✓ Sin fallos.',
  avisos.length ? `\n! ${avisos.length} aviso(s):\n` + avisos.map((a) => '  · ' + a).join('\n') : '',
].join('\n');
console.log(resumen);
writeFileSync(`${SALIDA}/ultimo-informe.txt`, resumen);
process.exit(fallos.length ? 1 : 0);

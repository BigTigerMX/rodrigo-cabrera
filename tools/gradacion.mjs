/* =========================================================
   GRADACIÓN DE LA OBRA — rodrigo-cabrera
   ---------------------------------------------------------
   Las fotos de obra son de teléfono, tomadas en días, horas y
   luces distintas: una sale azul de sombra, otra naranja de
   foco, otra plana de mediodía. Puestas en fila leen como un
   carrete, no como una serie.

   Esto no re-fotografía nada (no se puede). Hace lo que sí se
   puede: nivelar cada foto por separado y ponerles a todas
   ENCIMA la misma gradación, que es lo que convierte fotos
   sueltas en una serie.

   Por foto:
     1. Nivel automático   — estira el rango real a 0..255 con
                             recorte del 0.4% en cada punta.
     2. Balance de blancos — acerca los tres canales al gris,
                             pero con tope (±7%): una casa con
                             piso de madera DEBE seguir siendo
                             cálida; corregirla del todo la
                             volvería un quirófano.
   A todas igual:
     3. Curva en S suave, saturación al 88%, sombras hacia el
        azul del plano y altas apenas cálidas, y un negro
        levantado (mate) para que empasten entre sí.

   La marca de agua de ARCO se respeta: no se recorta nada.

   Uso: node tools/gradacion.mjs [--forzar]
   Salida: assets/img/obra/serie/*.jpg  (los originales no se tocan)
   ========================================================= */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  const raiz = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = require(`${raiz}/playwright`));
}

const BASE = 'http://127.0.0.1:8099';
const ORIGEN = 'assets/img/obra';
const DESTINO = 'assets/img/obra/serie';
const ANCHO_MAX = 1600;
const CALIDAD = 0.84;
const FORZAR = process.argv.includes('--forzar');

// Las que aparecen en la página. El resto de la carpeta no se procesa.
const FOTOS = ['G18.jpg', 'G11.jpg', 'G10.jpg', 'G12.jpg', 'G2.jpg', 'G17.jpg', 'G9.jpg', 'G19.jpg'];

const navegador = await chromium.launch();
const page = await navegador.newPage();
await page.goto(`${BASE}/index.html?grad=1`, { waitUntil: 'domcontentloaded' });

mkdirSync(DESTINO, { recursive: true });

const receta = await page.evaluate(() => 1); // calienta el contexto
void receta;

for (const nombre of FOTOS) {
  const salida = `${DESTINO}/${nombre}`;
  if (!FORZAR && existsSync(salida) && statSync(salida).mtimeMs > statSync(`${ORIGEN}/${nombre}`).mtimeMs) {
    console.log(`= ${nombre} (ya estaba al día)`);
    continue;
  }
  const datos = await page.evaluate(async ({ url, anchoMax, calidad }) => {
    const img = new Image();
    img.src = url;
    await img.decode();

    // 1) primero el tamaño final: gradar 2 Mpx para luego tirar la mitad
    //    es tiempo perdido, y el remuestreo después de la curva ensucia
    const escala = Math.min(1, anchoMax / img.naturalWidth);
    const W = Math.round(img.naturalWidth * escala);
    const H = Math.round(img.naturalHeight * escala);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, W, H);

    const id = cx.getImageData(0, 0, W, H);
    const d = id.data;
    const n = d.length / 4;

    // ---- 1. nivel automático sobre la luminancia ----
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      hist[(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0]++;
    }
    const recorte = n * 0.004;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > recorte) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > recorte) { hi = v; break; } }
    if (hi - lo < 24) { lo = 0; hi = 255; } // foto ya plana: no forzar
    const ganancia = 255 / (hi - lo);

    // ---- 2. balance de blancos con tope ----
    let sR = 0, sG = 0, sB = 0;
    for (let i = 0; i < d.length; i += 4) { sR += d[i]; sG += d[i + 1]; sB += d[i + 2]; }
    const mR = sR / n, mG = sG / n, mB = sB / n, gris = (mR + mG + mB) / 3;
    const tope = (x) => Math.min(1.07, Math.max(0.93, x));
    const wR = tope(gris / (mR || 1)), wG = tope(gris / (mG || 1)), wB = tope(gris / (mB || 1));

    // ---- 3. la misma gradación para todas ----
    const suave = (x) => x * x * (3 - 2 * x);         // curva en S
    const MEZCLA_S = 0.3;                              // cuánta S
    const SAT = 0.88;
    const SOMBRA = [-3, 1, 9];                         // sombras al azul del plano
    const ALTA = [5, 2, -3];                           // altas apenas cálidas
    const NEGRO = 5;                                   // negro levantado (mate)

    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = (v - lo) * ganancia;
      x = Math.min(255, Math.max(0, x)) / 255;
      x = x * (1 - MEZCLA_S) + suave(x) * MEZCLA_S;
      lut[v] = Math.round(x * 255);
    }

    for (let i = 0; i < d.length; i += 4) {
      let r = lut[Math.min(255, Math.round(d[i] * wR))];
      let g = lut[Math.min(255, Math.round(d[i + 1] * wG))];
      let b = lut[Math.min(255, Math.round(d[i + 2] * wB))];

      const luz = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luz + (r - luz) * SAT;
      g = luz + (g - luz) * SAT;
      b = luz + (b - luz) * SAT;

      const t = luz / 255;
      r += SOMBRA[0] * (1 - t) + ALTA[0] * t;
      g += SOMBRA[1] * (1 - t) + ALTA[1] * t;
      b += SOMBRA[2] * (1 - t) + ALTA[2] * t;

      d[i] = Math.max(0, Math.min(255, r * 0.98 + NEGRO));
      d[i + 1] = Math.max(0, Math.min(255, g * 0.98 + NEGRO));
      d[i + 2] = Math.max(0, Math.min(255, b * 0.98 + NEGRO));
    }
    cx.putImageData(id, 0, 0);

    return {
      jpeg: cv.toDataURL('image/jpeg', calidad).split(',')[1],
      W, H, lo, hi,
      wb: [wR.toFixed(3), wG.toFixed(3), wB.toFixed(3)],
    };
  }, { url: `${BASE}/${ORIGEN}/${nombre}`, anchoMax: ANCHO_MAX, calidad: CALIDAD });

  writeFileSync(salida, Buffer.from(datos.jpeg, 'base64'));
  const antes = (statSync(`${ORIGEN}/${nombre}`).size / 1024) | 0;
  const despues = (statSync(salida).size / 1024) | 0;
  console.log(`✓ ${nombre}  ${datos.W}×${datos.H}  nivel ${datos.lo}→${datos.hi}  bb ${datos.wb.join('/')}  ${antes}KB → ${despues}KB`);
}

await navegador.close();
void readFileSync;

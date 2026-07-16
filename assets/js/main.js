/* =========================================================
   RODRIGO CABRERA · Arquitecto — main.js
   ========================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  var lerp = function (a, b, n) { return a + (b - a) * n; };

  /* ---------- 1. Header ---------- */
  var header = document.querySelector('.site-header');
  function onScrollHeader() { if (header) header.classList.toggle('scrolled', window.scrollY > 60); }
  onScrollHeader();

  /* ---------- 2. Menú móvil ---------- */
  var toggle = document.querySelector('.nav__toggle');
  var links = document.querySelector('.nav__links');
  function setMenu(open) {
    if (!links || !toggle) return;
    links.classList.toggle('open', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('no-scroll', open);
  }
  if (toggle && links) {
    toggle.addEventListener('click', function () { setMenu(!links.classList.contains('open')); });
    links.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 760) setMenu(false); });
  }

  /* ---------- 3. Título del hero: dividir en letras ---------- */
  document.querySelectorAll('[data-letters]').forEach(function (el) {
    var txt = el.textContent;
    el.textContent = '';
    var i = 0;
    txt.split('').forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'ch';
      s.textContent = c === ' ' ? ' ' : c;
      s.style.transitionDelay = (0.04 * i++) + 's';
      el.appendChild(s);
    });
  });

  /* ---------- 4. Dividir en palabras ---------- */
  function splitWords(el) {
    if (el.dataset.splitDone) return;
    var delay = 0;
    (function walk(node) {
      var kids = [].slice.call(node.childNodes);
      kids.forEach(function (child) {
        if (child.nodeType === 3) {
          var frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(function (part) {
            if (part.trim() === '') { frag.appendChild(document.createTextNode(part)); return; }
            var w = document.createElement('span'); w.className = 'word';
            var inner = document.createElement('span'); inner.className = 'word__in';
            inner.textContent = part; inner.style.transitionDelay = (delay += 0.045) + 's';
            w.appendChild(inner); frag.appendChild(w);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1) { walk(child); }
      });
    })(el);
    el.dataset.splitDone = '1';
  }
  document.querySelectorAll('[data-split]').forEach(splitWords);

  /* ---------- 5. SVG blueprint: preparar trazos ---------- */
  var bpPaths = [].slice.call(document.querySelectorAll('.bp [data-draw]'));
  bpPaths.forEach(function (p) {
    try {
      var L = p.getTotalLength();
      p.style.strokeDasharray = L;
      p.style.strokeDashoffset = reduceMotion ? 0 : L;
      p.dataset.len = L;
    } catch (e) {}
  });
  function drawBp(svgRoot, prog) {
    if (reduceMotion) return;
    var paths = svgRoot ? svgRoot.querySelectorAll('[data-draw]') : bpPaths;
    var n = paths.length;
    for (var i = 0; i < n; i++) {
      var p = paths[i], L = parseFloat(p.dataset.len || 0);
      if (!L) continue;
      // cada trazo se dibuja escalonado
      var start = i / n * 0.6;
      var local = Math.min(Math.max((prog - start) / 0.4, 0), 1);
      p.style.strokeDashoffset = L * (1 - local);
    }
  }

  /* ---------- 6. Obras: layout horizontal ---------- */
  var works = document.querySelector('.works');
  var track = document.querySelector('.works__track');
  var worksBar = document.querySelector('.works__progress i');
  var horizontal = false;
  function setupWorks() {
    if (!works || !track) return;
    var want = window.innerWidth > 900 && !reduceMotion;
    if (want === horizontal) { if (horizontal) sizeWorks(); return; }
    horizontal = want;
    works.classList.toggle('stacked', !horizontal);
    if (horizontal) sizeWorks();
    else { works.style.height = ''; track.style.transform = ''; }
  }
  function sizeWorks() {
    // altura de scroll = desplazamiento horizontal + 1 viewport
    var span = track.scrollWidth - window.innerWidth;
    if (span < 0) span = 0;
    works.style.height = (span + window.innerHeight * 1.6) + 'px';
  }
  window.addEventListener('resize', setupWorks);
  setupWorks();
  window.addEventListener('load', setupWorks);

  /* ---------- 7. Motor de scroll (sin IO/rAF: directo) ---------- */
  var revealEls = [].slice.call(document.querySelectorAll('.reveal, .reveal-img, .stagger, [data-split]'));
  function activate(el) {
    if (el.__revealed) return;
    el.__revealed = true;
    el.classList.add('in', 'is-in');
  }
  var pxEls = [].slice.call(document.querySelectorAll('[data-parallax]'));
  var heroPlan = document.querySelector('.hero__plan svg');
  var dimSvg = document.querySelector('.dimline svg');
  var contactPlan = document.querySelector('.contact__plan svg');
  var sections = [].slice.call(document.querySelectorAll('section[id]'));
  var navLinks = [].slice.call(document.querySelectorAll('.nav__links a[href^="#"]'));

  function frame() {
    var vh = window.innerHeight;
    onScrollHeader();

    // revelados
    for (var i = 0; i < revealEls.length; i++) {
      var el = revealEls[i];
      if (el.__revealed) continue;
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.88) activate(el);
    }

    if (!reduceMotion) {
      // parallax genérico
      for (var p = 0; p < pxEls.length; p++) {
        var pe = pxEls[p], pr = pe.getBoundingClientRect();
        if (pr.bottom < -200 || pr.top > vh + 200) continue;
        var sp = parseFloat(pe.getAttribute('data-parallax')) || 0.1;
        var off = (pr.top + pr.height / 2 - vh / 2) * sp;
        pe.style.transform = 'translate3d(0,' + off.toFixed(1) + 'px,0)';
      }
      // plano del hero: se dibuja durante el primer viewport
      if (heroPlan) {
        var hp = Math.min(Math.max(1 - (document.querySelector('.hero').getBoundingClientRect().bottom - vh * 0.4) / (vh * 0.9), 0), 1);
        drawBp(heroPlan, 0.35 + hp * 0.65);
      }
      // línea de cota del manifiesto
      if (dimSvg) {
        var dr = dimSvg.getBoundingClientRect();
        var dp = Math.min(Math.max((vh - dr.top) / (vh * 0.7), 0), 1);
        drawBp(dimSvg, dp);
      }
      // plano del contacto
      if (contactPlan) {
        var cr = contactPlan.getBoundingClientRect();
        var cp = Math.min(Math.max((vh - cr.top) / (vh * 0.8), 0), 1);
        drawBp(contactPlan, cp);
      }
      // obras horizontales
      if (horizontal && works) {
        var wr = works.getBoundingClientRect();
        var total = works.offsetHeight - vh;
        var prog = Math.min(Math.max(-wr.top / (total <= 0 ? 1 : total), 0), 1);
        var span = track.scrollWidth - window.innerWidth;
        track.style.transform = 'translate3d(' + (-prog * span).toFixed(1) + 'px,0,0)';
        if (worksBar) worksBar.style.width = (prog * 100).toFixed(1) + '%';
      }
      // banda panorámica
      var pano = document.querySelector('.pano__img');
      if (pano) {
        var pnr = pano.parentElement.getBoundingClientRect();
        if (pnr.bottom > 0 && pnr.top < vh) {
          var pp = (vh - pnr.top) / (vh + pnr.height);
          pano.style.transform = 'translate3d(0,' + ((pp - 0.5) * 90).toFixed(1) + 'px,0)';
        }
      }
    }

    // nav activo
    if (sections.length && navLinks.length) {
      var mid = vh * 0.35, activeId = null;
      for (var s = 0; s < sections.length; s++) {
        var sr = sections[s].getBoundingClientRect();
        if (sr.top <= mid && sr.bottom >= mid) { activeId = sections[s].id; break; }
      }
      if (activeId) navLinks.forEach(function (l) { l.classList.toggle('active', l.getAttribute('href') === '#' + activeId); });
    }
  }
  // Motor por rAF: no depende de eventos de scroll (más suave y a prueba
  // de navegadores que no los disparan de forma fiable).
  if (reduceMotion) revealEls.forEach(activate);
  frame();
  (function rafLoop() { frame(); requestAnimationFrame(rafLoop); })();
  window.addEventListener('load', function () { setupWorks(); frame(); });

  /* ---------- 8. Lightbox de obras ---------- */
  var lb = document.querySelector('.lightbox');
  if (lb) {
    var lbImg = lb.querySelector('img'), lbCap = lb.querySelector('.lb-cap');
    var items = [].slice.call(document.querySelectorAll('.wpanel__media'));
    var cur = 0;
    function renderLb() {
      var t = items[cur]; if (!t) return;
      var img = t.querySelector('img');
      lbImg.src = img.getAttribute('data-full') || img.src;
      lbCap.textContent = t.getAttribute('data-title') || '';
    }
    function openLb(t) { cur = items.indexOf(t); renderLb(); lb.classList.add('open'); document.body.style.overflow = 'hidden'; }
    function closeLb() { lb.classList.remove('open'); document.body.style.overflow = ''; }
    function move(d) { cur = (cur + d + items.length) % items.length; renderLb(); }
    items.forEach(function (t) { t.addEventListener('click', function () { openLb(t); }); });
    lb.querySelector('.lb-close').addEventListener('click', closeLb);
    lb.querySelector('.lb-next').addEventListener('click', function () { move(1); });
    lb.querySelector('.lb-prev').addEventListener('click', function () { move(-1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    });
  }

  /* ---------- 9. Cursor personalizado + magnético ---------- */
  if (finePointer && !reduceMotion) {
    var ring = document.querySelector('.cursor');
    var dot = document.querySelector('.cursor-dot');
    var label = document.querySelector('.cursor__label');
    if (ring && dot) {
      document.body.classList.add('has-cursor');
      var mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
      window.addEventListener('mousemove', function (e) {
        mx = e.clientX; my = e.clientY;
        dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0) translate(-50%,-50%)';
        if (label && label.classList.contains('show')) label.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0) translate(-50%,-50%) scale(1)';
        ring.style.opacity = dot.style.opacity = '1';
      });
      (function ringLoop() {
        rx = lerp(rx, mx, 0.17); ry = lerp(ry, my, 0.17);
        ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0) translate(-50%,-50%)';
        requestAnimationFrame(ringLoop);
      })();
      document.addEventListener('mouseleave', function () { ring.style.opacity = dot.style.opacity = '0'; });
      document.querySelectorAll('a, button, .filter').forEach(function (el) {
        el.addEventListener('mouseenter', function () { ring.classList.add('is-hover'); });
        el.addEventListener('mouseleave', function () { ring.classList.remove('is-hover'); });
      });
      document.querySelectorAll('.wpanel__media, [data-cursor]').forEach(function (el) {
        var text = el.getAttribute('data-cursor') || 'Ver';
        el.addEventListener('mouseenter', function () { ring.classList.add('is-media'); if (label) { label.textContent = text; label.classList.add('show'); } });
        el.addEventListener('mouseleave', function () { ring.classList.remove('is-media'); if (label) label.classList.remove('show'); });
      });
      document.querySelectorAll('.btn, .nav__cta').forEach(function (btn) {
        btn.addEventListener('mousemove', function (e) {
          var r = btn.getBoundingClientRect();
          btn.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * 0.3) + 'px,' + ((e.clientY - r.top - r.height / 2) * 0.4) + 'px)';
        });
        btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });
      });
    }
  }

  /* ---------- 10. Loader (solo al entrar al sitio) ---------- */
  var loader = document.querySelector('.loader');
  var hero = document.querySelector('.hero');
  function enterHero() {
    if (!hero) return;
    hero.classList.add('enter');
    hero.querySelectorAll('[data-split]').forEach(function (el) { el.classList.add('is-in'); });
  }
  function removeLoaderNow() {
    document.body.classList.remove('loading');
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
  }
  function startWithLoader() {
    if (loader) loader.classList.add('done');
    document.body.classList.remove('loading');
    enterHero();
    setTimeout(function () { if (loader && loader.parentNode) loader.parentNode.removeChild(loader); }, 1100);
  }
  var entered = false;
  try { entered = sessionStorage.getItem('rcEntered') === '1'; } catch (e) {}
  if (reduceMotion || entered) {
    removeLoaderNow(); enterHero();
  } else {
    try { sessionStorage.setItem('rcEntered', '1'); } catch (e) {}
    var started = false;
    var kick = function () { if (started) return; started = true; startWithLoader(); };
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(kick, 950);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(kick, 950); });
    setTimeout(kick, 2600); // failsafe
  }

  /* ---------- 11. Formulario de contacto (FormSubmit) ---------- */
  var cform = document.querySelector('.contact__form');
  if (cform) {
    var MAIL_ENDPOINT = 'https://formsubmit.co/ajax/luis.santi.tiger@gmail.com';
    var MAIL_CC = 'arquitecto@rodrigo-cabrera.com';
    cform.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!cform.checkValidity()) { cform.reportValidity(); return; }
      var nombre = cform.querySelector('#c-n').value.trim();
      var correo = cform.querySelector('#c-e').value.trim();
      var mensaje = cform.querySelector('#c-m').value.trim();
      var note = cform.querySelector('.cf-note');
      var btn = cform.querySelector('button[type="submit"]');
      btn.disabled = true;
      var btnSpan = btn.querySelector('span');
      var btnText = btnSpan.textContent;
      btnSpan.textContent = 'Enviando…';
      fetch(MAIL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          Nombre: nombre,
          Correo: correo,
          Mensaje: mensaje,
          _subject: 'Nuevo mensaje desde rodrigo-cabrera — ' + nombre,
          _replyto: correo,
          _cc: MAIL_CC,
          _template: 'table',
          _captcha: 'false'
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || String(j.success) !== 'true') throw new Error(j && j.message);
        if (note) note.textContent = 'Gracias por tu mensaje. Te respondo muy pronto.';
        cform.reset();
      }).catch(function () {
        if (note) note.textContent = 'No se pudo enviar. Escríbeme a ' + MAIL_CC + '.';
      }).finally(function () {
        btn.disabled = false;
        btnSpan.textContent = btnText;
      });
    });
  }

  /* ---------- 12. Año ---------- */
  document.querySelectorAll('.year').forEach(function (y) { y.textContent = new Date().getFullYear(); });
})();

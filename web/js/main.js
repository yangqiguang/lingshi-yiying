/* =====================================================
   本地网页框架 - 交互脚本（原生 JS，无依赖）
   1. 移动端菜单开关
   2. 滚动时高亮当前导航
   3. 滚动显现动画
   4. 页脚年份自动更新
   ===================================================== */
(function () {
  'use strict';

  /* ---------- 1. 移动端菜单开关 ---------- */
  var toggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('open');
      toggle.classList.toggle('active', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    // 点击菜单项后自动收起菜单
    var navLinks = nav.querySelectorAll('.nav-link');
    Array.prototype.forEach.call(navLinks, function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- 2. 滚动时高亮当前导航 ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
  var sections = links
    .map(function (link) {
      var href = link.getAttribute('href');
      return href && href.charAt(0) === '#' ? document.querySelector(href) : null;
    })
    .filter(Boolean);

  function updateActiveLink() {
    var scrollPos = window.scrollY + 120; // 偏移量，让高亮更跟手
    var currentId = '';

    sections.forEach(function (sec) {
      if (sec.offsetTop <= scrollPos) {
        currentId = '#' + sec.id;
      }
    });

    links.forEach(function (link) {
      var active = link.getAttribute('href') === currentId;
      link.classList.toggle('active', active);
    });
  }

  if (sections.length) {
    window.addEventListener('scroll', updateActiveLink, { passive: true });
    updateActiveLink();
  }

  /* ---------- 3. 滚动显现动画 ---------- */
  var revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && revealEls.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target); // 只显现一次
          }
        });
      },
      { threshold: 0.15 }
    );

    revealEls.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    // 浏览器不支持时直接显示，不阻塞内容
    revealEls.forEach(function (el) {
      el.classList.add('visible');
    });
  }

  /* ---------- 4. 页脚年份自动更新 ---------- */
  var yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
})();

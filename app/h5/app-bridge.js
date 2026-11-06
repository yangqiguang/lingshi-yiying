/* =====================================================
   灵视医影 · HBuilderX(5+) 原生壳桥接
   仅在 HBuilderX / App(web-view 加载本地 html) 中生效；
   普通浏览器双击打开时 plus 不存在，本脚本静默不执行。
   作用：沉浸式状态栏适配、状态栏文字明暗随页面切换、
        Android 物理返回键走 APP 内部路由栈、全面屏底部安全区。
   ===================================================== */
(function () {
  'use strict';

  var CSS = [
    ':root{--sat:env(safe-area-inset-top,0px);--sab:env(safe-area-inset-bottom,0px);}',
    /* 隐藏网页里绘制的假状态栏，改用真机系统状态栏 */
    '.inapp .statusbar{display:none !important;}',
    /* 自定义导航栏顶部让出状态栏高度 */
    '.inapp .screen.active .navbar{height:auto !important;min-height:48px;box-sizing:border-box;padding-top:calc(var(--sat) + 8px) !important;padding-bottom:8px !important;}',
    /* 首页 / 我的（深色渐变头） */
    '.inapp #home.active .home-head{padding-top:calc(var(--sat) + 16px) !important;}',
    '.inapp #me.active .me-head{padding-top:calc(var(--sat) + 18px) !important;}',
    /* 影像报告 / 康复训练（浅色 Tab，无导航栏，内容从顶部开始） */
    '.inapp #report.active .screen-body,.inapp #plan.active .screen-body{padding-top:calc(var(--sat) + 14px) !important;}',
    /* 登录页、启动页、打卡成功全屏页整体下移状态栏高度 */
    '.inapp #login.active .login-body{padding-top:var(--sat) !important;padding-bottom:calc(24px + var(--sab)) !important;}',
    '.inapp .screen.full.active{padding-top:var(--sat) !important;}',
    '.inapp .sp-foot{bottom:calc(18px + var(--sab)) !important;}',
    /* 前后对比深色页底部面板让出手势条 */
    '.inapp #compare.active .cmp-metrics{padding-bottom:calc(12px + var(--sab)) !important;}',
    /* 底部 Tab 栏、底部固定按钮让出全面屏手势条 */
    '.inapp .tabbar{padding-bottom:var(--sab) !important;}',
    '.inapp [data-tab].active .screen-body{padding-bottom:calc(86px + var(--sab)) !important;}',
    '.inapp .fixed-actions{padding-bottom:calc(10px + var(--sab)) !important;background:linear-gradient(to top,#f5f7fa 70%,rgba(245,247,250,0));}',
    /* AI 页：快捷问题条 + 输入栏一起让出安全区，否则会被手势条压住 */
    '.inapp .ai-input-bar{height:calc(66px + var(--sab)) !important;padding-bottom:calc(10px + var(--sab)) !important;}',
    '.inapp .ai-quick{bottom:calc(66px + var(--sab)) !important;}',
    '.inapp .screen-body.no-tab.ai-body{padding-bottom:calc(190px + var(--sab)) !important;}'
  ].join('\n');

  var DARK_SCREENS = { splash: 1, home: 1, me: 1, done: 1, compare: 1 };

  function currentId() {
    var m = /#([\w-]+)/.exec(location.hash);
    return m ? m[1] : 'splash';
  }

  function setStatusBarStyle(id) {
    try {
      var darkBg = !!DARK_SCREENS[id];
      // light = 白色文字（用于深色背景页）；dark = 黑色文字（浅色背景页）
      plus.navigator.setStatusBarStyle(darkBg ? 'light' : 'dark');
    } catch (e) {}
  }

  var lastBack = 0;
  function onBack() {
    try {
      if (window.__appCanBack && window.__appCanBack()) {
        window.__appBack();
        return;
      }
    } catch (e) {}
    // 已在根页面：2 秒内再按一次退出
    var now = Date.now();
    if (now - lastBack < 2000) {
      try { plus.runtime.quit(); } catch (e) {}
    } else {
      lastBack = now;
      try { plus.nativeUI.toast('再按一次退出灵视医影'); } catch (e) {}
    }
  }

  function init() {
    if (window.__bridgeReady) return;
    window.__bridgeReady = true;
    document.documentElement.classList.add('inapp');

    // 注入适配样式
    var st = document.createElement('style');
    st.id = 'app-bridge-style';
    st.textContent = CSS;
    document.head.appendChild(st);

    // 取准确状态栏高度（拿不到则回退 env(safe-area-inset-top)）
    try {
      var h = plus.navigator.getStatusbarHeight();
      if (h && h > 0) document.documentElement.style.setProperty('--sat', h + 'px');
    } catch (e) {}

    // 供 app.js 切屏时回调，同步状态栏文字明暗
    window.__onScreenChange = setStatusBarStyle;
    setStatusBarStyle(currentId());

    // Android 物理返回键
    try { plus.key.addEventListener('backbutton', onBack); } catch (e) {}
  }

  if (window.plus) {
    init();
  } else {
    document.addEventListener('plusready', init, false);
  }
})();

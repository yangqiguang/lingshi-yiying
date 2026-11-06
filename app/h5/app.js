/* =====================================================
   灵视医影 · 个人康复 APP（H5 高保真原型）交互
   前端演示 + 可选接入 DeepSeek 真实后端（真实优先，离线回落本地模板）
   ===================================================== */
(function () {
  'use strict';
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* =====================================================
     一、运行配置 + 病例时间锚点
     病例日期不再写死，全部以「运行当天」为基准相对推算，
     任何时间打开都不会出现「复查日期已过、却还显示还有 20 天」。
     ===================================================== */
  var CFG = window.APP_CONFIG || {};
  var TODAY = (function () {
    if (CFG.DEMO_DATE) {
      var p = String(CFG.DEMO_DATE).split('-');
      if (p.length === 3) return new Date(+p[0], +p[1] - 1, +p[2]);
    }
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  })();
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dayAdd(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function md(d) { return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function compact(d) { return ymd(d).replace(/-/g, ''); }
  function diffDays(a, b) { return Math.round((a - b) / 86400000); }
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function wd(d) { return WD[d.getDay()]; }

  /* 病例时间轴：受伤 →15 天 → 今天 → 9 天 → 下次复查 */
  var C = {
    injure: dayAdd(TODAY, -15),        // 受伤 / 初诊 / 初诊影像
    week1: dayAdd(TODAY, -8),          // 进入保护期
    follow: dayAdd(TODAY, -1),         // 上次复查影像、复评拆固定
    stage2: TODAY,                     // 进入活动恢复期
    next: dayAdd(TODAY, 9)             // 下次复查（计划）
  };
  var STAGE_WEEK = Math.floor(diffDays(TODAY, C.injure) / 7) + 1;   // 第 3 周
  var DAYS_TO_VISIT = diffDays(C.next, TODAY);                      // 距复查还有 9 天
  var CASE_NO = 'LSY-' + compact(C.injure) + '-008';
  var RPT_NO = 'RPT-' + compact(C.follow) + '-008';
  var OLD_CASE_NO = 'LSY-' + compact(dayAdd(TODAY, -357)) + '-021';

  /* 旧稿写死的日期 → 新的相对日期（正文里的日期一次性重绘，避免遗漏） */
  var DATE_MAP = {};
  DATE_MAP['2026-09-10'] = C.injure;
  DATE_MAP['2026-09-17'] = dayAdd(C.injure, 7);
  DATE_MAP['2026-09-24'] = C.follow;
  DATE_MAP['2026-09-26'] = C.stage2;
  DATE_MAP['2026-09-19'] = TODAY;
  DATE_MAP['2026-09-16'] = dayAdd(TODAY, -3);
  DATE_MAP['2026-09-15'] = dayAdd(TODAY, -5);
  DATE_MAP['2026-10-08'] = C.next;
  DATE_MAP['2026-01-12'] = dayAdd(TODAY, -330);
  DATE_MAP['2025-11-20'] = dayAdd(TODAY, -357);

  function paintDates() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode && node.parentNode.nodeName;
        if (p === 'SCRIPT' || p === 'STYLE') return NodeFilter.FILTER_REJECT;
        return /\S/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var t = node.nodeValue;
      t = t.replace(/LSY-\d{8}-008/g, CASE_NO)
           .replace(/LSY-\d{8}-021/g, OLD_CASE_NO)
           .replace(/RPT-\d{8}-008/g, RPT_NO)
           .replace(/(20\d{2}-\d{2}-\d{2})|(\d{2}-\d{2})/g, function (m, full, short) {
             var key = full || ('2026-' + short);
             var d = DATE_MAP[key];
             if (!d) return m;
             return full ? ymd(d) : md(d);
           })
           .replace(/第\s*3\s*周/g, '第 ' + STAGE_WEEK + ' 周')
           .replace(/距复查还有\s*\d+\s*天/g, '距复查还有 ' + DAYS_TO_VISIT + ' 天')
           .replace(/（周四）/g, '（' + wd(C.next) + '）')
           .replace(/周四 · 上午/g, wd(C.next) + ' · 上午');
      if (t !== node.nodeValue) node.nodeValue = t;
    });
    rebuildWeekRow();
    var vp = $('#visitProg');
    if (vp) vp.style.width = Math.round(14 / 23 * 100) + '%';
  }

  /* 消息中心时间：按相对「今天」的天数动态渲染，避免写死「今天 09:12」这类自相矛盾的戳 */
  function paintMsgTimes() {
    function relTxt(rel) {
      rel = parseInt(rel, 10);
      if (isNaN(rel)) return '';
      if (rel === 0) return '今天';
      if (rel === -1) return '昨天';
      if (rel === -2) return '前天';
      return md(dayAdd(TODAY, rel));
    }
    $$('time[data-rel]').forEach(function (t) { t.textContent = relTxt(t.getAttribute('data-rel')); });
    $$('[data-date]').forEach(function (el) {
      var d = DATE_MAP_KEY(el.getAttribute('data-date'));
      if (d) el.textContent = ymd(d);
    });
  }
  /* 具名日期：follow=上次复查、next=下次复查、injure=受伤日 */
  function DATE_MAP_KEY(k) {
    if (k === 'follow') return C.follow;
    if (k === 'next') return C.next;
    if (k === 'injure') return C.injure;
    if (k === 'stage2') return C.stage2;
    return null;
  }

  /* 本周计划：按真实日历生成，今天高亮，之前的日期标记已完成 */
  function rebuildWeekRow() {
    var row = $('.week-row');
    if (!row) return;
    var mon = dayAdd(TODAY, -((TODAY.getDay() + 6) % 7));   // 本周一
    var html = '';
    for (var i = 0; i < 7; i++) {
      var d = dayAdd(mon, i);
      var isToday = diffDays(d, TODAY) === 0;
      var cls = isToday ? 'today' : (d < TODAY ? 'done' : '');
      var note = isToday ? (doneToday() + '/3') : (d.getDay() === 6 ? '休息' : '3 项');
      if (cls === 'done' && d.getDay() === 6) note = '休息';
      html += '<div class="day ' + cls + '"><div class="dw">' + wd(d) + '</div>' +
              '<div class="dn">' + d.getDate() + '</div><div class="dc">' + note + '</div></div>';
    }
    row.innerHTML = html;
  }

  /* ---------- 状态栏注入 ---------- */
  var SB_ICONS =
    '<span class="sb-icons">' +
    '<svg width="17" height="11" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0.5" width="3" height="11.5" rx="1"/></svg>' +
    '<svg width="16" height="12" viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 7.5a15 15 0 0 1 20 0"/><path d="M5.5 11.5a9.5 9.5 0 0 1 13 0"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>' +
    '<svg width="25" height="12" viewBox="0 0 26 13"><rect x="1" y="1.2" width="21" height="10.6" rx="3" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="3" y="3.2" width="15" height="6.6" rx="1.4" fill="currentColor"/><rect x="23.2" y="4.4" width="2" height="4.2" rx="1" fill="currentColor"/></svg>' +
    '</span>';
  /* 状态栏时间用真实时间，别写死 9:41（真机上会与系统时间打架） */
  var NOW_HM = (function () {
    var n = new Date();
    return n.getHours() + ':' + pad2(n.getMinutes());
  })();
  $$('.screen').forEach(function (s) {
    if (s.classList.contains('no-status')) return;
    var sb = document.createElement('div');
    sb.className = 'statusbar' + (s.classList.contains('dark') ? ' dark' : '');
    sb.innerHTML = '<span>' + NOW_HM + '</span>' + SB_ICONS;
    if (s.classList.contains('full')) sb.style.cssText = 'position:absolute;top:0;left:0;right:0;';
    s.insertBefore(sb, s.firstChild);
  });

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  /* ---------- 通用弹窗 ---------- */
  function openModal(html) { $('#modalBox').innerHTML = html; $('#modalMask').classList.add('show'); }
  function closeModal() { $('#modalMask').classList.remove('show'); }
  $('#modalMask').addEventListener('click', function (e) {
    if (e.target.id === 'modalMask') { closeModal(); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'msgSubmit') {
      var ta = $('#msgInput');
      var txt = ta ? ta.value.trim() : '';
      if (!txt) { toast('请先填写留言内容'); return; }
      closeModal();
      syncMessageRemote(txt, 'doctor');
      toast('留言已发送，医生 / 治疗师将在工作时间回复');
      return;
    }
    closeModal();
    if (act === 'logout') {
      if (AUTH_TOKEN) { api('POST', '/api/auth/logout', null, 5000).catch(function () {}); }
      AUTH_TOKEN = null; CUR_USER = null; LAST_CRED = null; saveAuth();
      applyRole('patient'); stack = ['login']; show('login'); toast('已退出登录');
    }
    else if (act === 'warnSubmit') {
      showDone('warn');
      /* 疼痛预警同步到服务器：医护端「今日预警」计数 +1 */
      syncCheckinRemote(parseInt($('#vas').value, 10) || 7, ymd(TODAY));
    }
  });
  function askLogout() {
    openModal(
      '<div class="m-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg></div>' +
      '<h4>退出登录？</h4><p>退出后需重新验证手机号方可查看康复数据</p>' +
      '<div class="m-btns"><button class="btn m-cancel" data-act="cancel">取消</button><button class="btn m-danger" data-act="logout">退出</button></div>'
    );
  }

  /* HTML 转义：凡是把「用户输入 / 大模型输出」拼进 innerHTML 的地方都必须先经过它 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 既往结案病例：影像按规范归档，不再提供调阅，避免与在案病例数据错位 */
  function openArchive() {
    openModal(
      '<div class="m-ico" style="background:var(--blue-l);color:var(--blue);"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg></div>' +
      '<h4>既往病例已归档</h4><p>该病例已结案，原始影像与报告按医疗档案规范归档保存，个人端仅保留结论摘要，不再提供影像调阅。</p>' +
      '<div class="m-btns"><button class="btn m-cancel" data-act="cancel">我知道了</button></div>'
    );
  }

  /* 在线留言：给轻量输入框，让「医患互动」真正走通，而不是每个按钮都弹 toast */
  function openMessage(who) {
    openModal(
      '<h4>给' + esc(who) + '留言</h4>' +
      '<p style="margin-bottom:10px;">请简要描述您的问题，医生 / 治疗师将在工作时间回复。</p>' +
      '<textarea id="msgInput" rows="3" maxlength="200" placeholder="例如：今天训练后手腕有些酸胀，需要调整动作吗？" style="width:100%;box-sizing:border-box;border:1px solid #dbe4f5;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;resize:none;outline:none;"></textarea>' +
      '<div class="m-btns"><button class="btn m-cancel" data-act="cancel">取消</button><button class="btn m-danger" data-act="msgSubmit">发送留言</button></div>'
    );
    var ta = $('#msgInput');
    if (ta) setTimeout(function () { try { ta.focus(); } catch (err) {} }, 60);
  }

  /* 用户协议 / 隐私政策：给正文，而不是弹一句「演示内容」 */
  var DOCS = {
    user:
      '<h4>用户协议（摘要）</h4>' +
      '<div class="doc-body">' +
      '<p><b>1. 服务性质</b>本应用为全国大学生数字媒体科技作品及创意竞赛参赛作品，用于展示运动损伤康复管理流程，当前版本为演示版本。</p>' +
      '<p><b>2. 非诊疗行为</b>应用内的影像识别、恢复度评分与 AI 问答均为辅助信息，不构成诊断、处方或运动回归许可。最终诊疗与康复安排以执业医师意见为准。</p>' +
      '<p><b>3. 账号使用</b>账号由机构管理员审核分发，仅限本人使用；不得转让、出借或用于任何商业用途。</p>' +
      '<p><b>4. 内容边界</b>应用不提供急症处置建议。出现剧烈疼痛、明显肿胀、肢体畸形或麻木时，请立即就医。</p>' +
      '<p><b>5. 变更</b>正式发布版将补充完整条款、生效日期与争议解决方式。</p>' +
      '</div>',
    privacy:
      '<h4>隐私政策（摘要）</h4>' +
      '<div class="doc-body">' +
      '<p><b>1. 收集范围</b>手机号、姓名、受伤部位与时间、影像资料、疼痛与训练记录。均为提供康复管理服务所必需。</p>' +
      '<p><b>2. 敏感个人信息</b>影像与伤情记录属于敏感个人信息，仅在您主动同意后收集，并单独告知处理目的、方式与必要性。</p>' +
      '<p><b>3. 使用目的</b>仅用于影像辅助识别、康复计划生成、复查提醒与向您的主治医生 / 治疗师同步病情，不用于广告推送。</p>' +
      '<p><b>4. 共享范围</b>向体育机构仅同步经您授权的损伤摘要与禁忌动作，不同步原始影像。</p>' +
      '<p><b>5. 您的权利</b>可随时在「设置 → 数据授权范围 / 撤回授权」查看授权记录并撤回同意；撤回后不影响此前已进行的处理。</p>' +
      '<p><b>6. 安全措施</b>账号分级、最小权限、传输加密、操作留痕；演示版本数据仅保存在本机。</p>' +
      '</div>',
    auth:
      '<h4>数据授权范围</h4>' +
      '<div class="doc-body">' +
      '<p><b>已授权的数据</b>经您本人同意，向您的主治医生（杨同学）与康复治疗师（张同学）共享：受伤部位与时间、影像资料、疼痛评分与训练打卡记录，用于制定与调整康复方案。</p>' +
      '<p><b>向体育机构同步</b>仅同步「损伤摘要 + 禁忌动作 + 预计回归时间」，用于校队训练安排；不同步原始影像与完整病历。</p>' +
      '<p><b>不共享</b>您的手机号、身份信息与原始影像不会提供给任何第三方。</p>' +
      '<p><b>撤回授权</b>您可随时申请撤回全部或部分授权；撤回后，相关医护与机构将停止访问您的康复数据，但不影响撤回前已完成的合法处理。</p>' +
      '<p><b>授权记录</b>当前授权状态：已同意（影像辅助识别 + 康复计划 + 复查提醒）。演示版本授权记录保存在本机，正式版将提供可下载的完整授权日志。</p>' +
      '</div>'
  };
  function openDoc(kind) {
    var body = DOCS[kind] || DOCS.user;
    openModal(body + '<div class="m-btns"><button class="btn m-cancel" data-act="cancel">关闭</button></div>');
  }

  /* ---------- 路由 ---------- */
  var TAB_IDS = { home: 1, report: 1, plan: 1, me: 1 };
  var PARENT = { messages: 'home', visit: 'home', viewer: 'report', compare: 'report', reportDetail: 'report', exercise: 'plan', today: 'plan', selfcheck: 'plan', done: 'plan', curve: 'plan', ladder: 'plan', profile: 'me', timeline: 'me', doctors: 'me', settings: 'me', staffHome: 'login', admin: 'login' };
  var stack = [];
  function show(id) {
    var el = document.getElementById(id);
    if (!el) return;
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
    var body = el.querySelector('.screen-body');
    if (body) body.scrollTop = 0;
    var tabbar = $('#tabbar');
    if (TAB_IDS[id]) {
      tabbar.style.display = 'flex';
      $$('.tab-item').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === id); });
    } else {
      tabbar.style.display = 'none';
    }
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    if (id === 'curve') renderCurve();
    if (id === 'home' || id === 'me') renderAllStats();
    if (id === 'ai') aiPaintNote(aiFailCount >= 2 ? 'fail' : '');
    if (id === 'admin') { renderPending(); renderAccounts(); }
    try { if (window.__onScreenChange) window.__onScreenChange(id); } catch (e) {}
  }
  function go(id) {
    if (!document.getElementById(id)) { toast('页面建设中'); return; }
    if (TAB_IDS[id]) stack = [id];
    else if (stack[stack.length - 1] !== id) stack.push(id);
    if (id === 'today') resetToday();
    show(id);
  }
  function back() {
    if (stack.length > 1) { stack.pop(); show(stack[stack.length - 1]); }
    else show(PARENT[stack[0]] || 'home');
  }

  /* ---------- 部位筛选 + 关键词搜索（报告屏 / 时间线屏通用） ---------- */
  function applyFilter(grp) {
    var f = grp.dataset.curf || 'all';
    var root = grp.parentElement;
    var kwInput = root.querySelector('.search-bar input');
    var kw = (kwInput && kwInput.value || '').trim().toLowerCase();
    $$('.case-card[data-type], .tl3-item[data-type]', root).forEach(function (it) {
      var typeOk = (f === 'all' || it.dataset.type === f);
      var kwOk = !kw || (it.textContent || '').toLowerCase().indexOf(kw) !== -1;
      it.style.display = (typeOk && kwOk) ? '' : 'none';
    });
  }
  var repSearch = $('#repSearch');
  if (repSearch) repSearch.addEventListener('input', function () {
    var grp = this.closest('.screen-body').querySelector('.filter-tabs');
    if (grp) applyFilter(grp);
  });

  /* ---------- 全局点击委托 ---------- */
  document.addEventListener('click', function (e) {
    var sw = e.target.closest('[data-switch-ui]');
    if (sw) { sw.classList.toggle('on'); return; }
    var pa = e.target.closest('[data-pa]');
    if (pa) {
      var action = pa.dataset.pa;
      if (action === 'disable' || action === 'enable') {
        var dkey = pa.dataset.key;
        if (dkey === '88888888') { toast('管理员账号不可停用'); return; }
        var dl = getDisabled();
        if (action === 'disable') { if (dl.indexOf(dkey) === -1) dl.push(dkey); toast('已停用，该账号将无法登录'); }
        else { dl = dl.filter(function (x) { return x !== dkey; }); toast('已启用该账号'); }
        setDisabled(dl); renderAccounts();
        return;
      }
      var pl = getPending(), pi = parseInt(pa.dataset.idx, 10), pr = pl[pi];
      if (pr) {
        pl.splice(pi, 1); setPending(pl);
        if (action === 'approve') {
          var al = getApproved();
          if (!al.some(function (x) { return x.phone === pr.phone; })) { al.push(pr); setApproved(al); }
          toast('已通过 ' + pr.name + ' 的注册申请，账号已生效');
        } else {
          toast('已拒绝 ' + pr.name + ' 的注册申请');
        }
        renderPending(); renderAccounts();
      }
      return;
    }

    var ft = e.target.closest('.filter-tabs .ft');
    if (ft) {
      var grp = ft.parentElement;
      $$('.ft', grp).forEach(function (x) { x.classList.remove('on'); });
      ft.classList.add('on');
      grp.dataset.curf = ft.dataset.f || 'all';
      applyFilter(grp);
      return;
    }

    var el = e.target.closest('[data-go],[data-toast],[data-back],[data-logout],[data-switch],[data-archive],[data-doc],[data-msg],.tab-item[data-tab]');
    if (!el) return;
    /* 注意：只认 .tab-item[data-tab]。此前选择器过于宽泛，
       点首页/报告页任意空白处都会命中 section 上的 data-tab，
       触发 go() → show() 把 scrollTop 归零，表现为「一点空白就弹回顶部」。 */
    if (el.hasAttribute('data-tab')) { go(el.dataset.tab); return; }
    if (el.hasAttribute('data-archive')) { openArchive(el.dataset.archive); return; }
    if (el.hasAttribute('data-doc')) { openDoc(el.dataset.doc); return; }
    if (el.hasAttribute('data-msg')) { openMessage(el.dataset.msg); return; }
    if (el.hasAttribute('data-go')) {
      /* 点开某条消息后，该条红点消失，铃铛同步，已读状态持久化 */
      var mi = el.closest('.msg-item');
      if (mi) {
        var u = mi.querySelector('.unread');
        if (u) { markOneRead(mi.getAttribute('data-go')); u.remove(); syncUnread(); }
      }
      go(el.dataset.go); return;
    }
    if (el.hasAttribute('data-back')) { back(); return; }
    if (el.hasAttribute('data-logout')) { askLogout(); return; }
    if (el.hasAttribute('data-switch')) { applyRole('patient'); stack = ['login']; show('login'); toast('已切换账号，请重新登录'); return; }
    if (el.hasAttribute('data-toast')) { toast(el.dataset.toast); return; }
  });

  /* ---------- 登录：患者 / 医护 / 管理员 ---------- */
  var currentRole = 'patient';
  var loginAs = 'patient';
  /* 按真实时间分时段问候，避免晚上还显示「早上好」 */
  function greetWord() {
    var h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }
  var ROLE_UI = {
    patient:   { av:'宋', nm:'宋同学',   sub:'篮球 · 校队　|　左腕康复中',   hgs:'今天也要坚持康复训练' },
    doctor:    { av:'杨', nm:'杨同学',   sub:'执业医师 · 运动创伤科',       hgs:'今日有 3 例影像待您复核' },
    therapist: { av:'张', nm:'张同学',   sub:'康复治疗师 · 运动康复',       hgs:'今日有 2 位患者待复诊' },
    technician:{ av:'沈', nm:'沈同学',   sub:'影像技师 · 影像分析',         hgs:'今日影像待分析' },
    admin:     { av:'管', nm:'管理员',   sub:'账号管理 · 机构运维',         hgs:'欢迎使用账号与权限管理' }
  };
  /* 新版后端五角色（中文） → 内部角色 key */
  var ROLE_MAP = {
    '患者': 'patient',
    '执业医师': 'doctor',
    '康复治疗师': 'therapist',
    '影像技师': 'technician',
    '机构管理员': 'admin'
  };
  function applyRole(role, name) {
    currentRole = role;
    document.body.classList.toggle('is-admin', role === 'admin');
    var m = ROLE_UI[role] || ROLE_UI.patient;
    var nm2 = m.nm, sub2 = m.sub, hgs2 = m.hgs;
    if (name) {
      nm2 = name;
      sub2 = role === 'doctor' ? '执业医师 · 影像复核与报告签发'
        : role === 'technician' ? '影像技师 · 影像采集与检查报告'
        : role === 'therapist' ? '康复治疗师 · 康复方案与周期随访'
        : role === 'admin' ? '机构管理员 · 账号与系统运维'
        : '患者 · 注册账号';
      hgs2 = (role === 'doctor' || role === 'therapist' || role === 'technician')
        ? '欢迎使用医护工作台' : '今天也要坚持康复训练';
    }
    var hg2 = role === 'admin' ? '管理员您好' : nm2 + '，' + greetWord();
    var av = $('#meAv'), nm = $('#meName'), sub = $('#meSub'), hg = $('#homeGreet'), hgs = $('#homeGreetSub');
    if (av) av.textContent = (name || m.av).slice(0, 1);
    if (nm) nm.textContent = nm2;
    if (sub) sub.textContent = sub2;
    if (hg) hg.textContent = hg2;
    if (hgs) hgs.textContent = hgs2;
    var shn = $('#shName'), shs = $('#shSub'), sha = $('#shAv');
    if (shn) shn.textContent = nm2;
    if (shs) shs.textContent = sub2;
    if (sha) sha.textContent = (name || m.av).slice(0, 1);
  }
  /* 角色切换后的 UI 同步（tab 切换 / 演示账号快填都会调用） */
  function syncRoleUI() {
    var isStaff = loginAs === 'staff';
    $$('.rs', $('#roleSwitch')).forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-as') === loginAs);
    });
    var ph = $('#phoneInput'), ci = $('#codeInput');
    if (ph) ph.placeholder = '请输入手机号';
    if (ci) ci.placeholder = isStaff ? '请输入登录密码' : '验证码 / 密码';
    var cb = $('#codeBtn'); if (cb) cb.style.display = isStaff ? 'none' : '';
    var eye = $('#pwdEye'); if (eye) eye.style.display = isStaff ? '' : 'none';
    var qi = $('#quickIn'); if (qi) qi.style.display = isStaff ? 'none' : '';
    var dh = $('#demoHint'); if (dh) dh.style.display = '';
    var gr = $('#goRegister'); if (gr) gr.style.display = '';
  }
  $('#roleSwitch').addEventListener('click', function (e) {
    var b = e.target.closest('.rs'); if (!b) return;
    loginAs = b.getAttribute('data-as');
    clearErr();
    syncRoleUI();
  });
  /* 演示账号一键填入：省掉手打 11 位手机号的时间 */
  $('#demoHint').addEventListener('click', function (e) {
    var b = e.target.closest('.quick-acct'); if (!b) return;
    loginAs = b.getAttribute('data-as') || 'staff';
    syncRoleUI();
    var ph = $('#phoneInput'), ci = $('#codeInput');
    if (ph) ph.value = b.getAttribute('data-acc');
    if (ci) { ci.value = '123456'; ci.type = 'password'; }
    var eye = $('#pwdEye'); if (eye) eye.classList.remove('showing');
    clearErr();
    toast('已填入「' + b.textContent + '」演示账号');
  });
  /* 密码显隐 */
  $('#pwdEye').addEventListener('click', function () {
    var ci = $('#codeInput'); if (!ci) return;
    var show = ci.type === 'password';
    ci.type = show ? 'text' : 'password';
    this.classList.toggle('showing', show);
  });
  /* 登录后的落地页：患者进个人端首页；医护/技师/治疗师进工作台；管理员进账号管理。
     避免此前「医生登录后看到的是宋同学的康复数据」这种越权观感。 */
  function homeFor(role) {
    if (role === 'admin') return 'admin';
    if (role === 'doctor' || role === 'therapist' || role === 'technician') return 'staffHome';
    return 'home';
  }
  /* 登录成功后进入对应角色页面（本地 / 远程共用） */
  function enterHome(role, loginName) {
    applyRole(role, loginName);
    var dest = homeFor(role);
    stack = [dest]; show(dest);
    if (role === 'admin') { toast('欢迎，管理员'); renderAdminRemote(); }
    else if (role === 'doctor') toast(loginName ? ('欢迎回来，' + loginName) : '欢迎，杨同学');
    else if (role === 'therapist') toast(loginName ? ('欢迎回来，' + loginName) : '欢迎，张同学');
    else if (role === 'technician') toast(loginName ? ('欢迎回来，' + loginName) : '欢迎，沈同学');
    else { toast(loginName ? ('欢迎回来，' + loginName) : '欢迎回来'); renderPatientRemote(); }
    if (role === 'doctor' || role === 'therapist' || role === 'technician') renderStaffRemote();
  }
  /* ---------- 登录 ---------- */
  /* 本地账号表（与后端 SEED_USERS 完全一致）：用于「秒进」和断网兜底 */
  var LOCAL_ACCOUNTS = [
    { acc: '13800000001', pwd: '123456', role: 'doctor',     name: '杨同学' },
    { acc: '13800000002', pwd: '123456', role: 'technician', name: '沈同学' },
    { acc: '13800000003', pwd: '123456', role: 'therapist',  name: '张同学' },
    { acc: '13800000004', pwd: '123456', role: 'admin',      name: '刘同学' },
    { acc: '13700000001', pwd: '123456', role: 'patient',    name: '宋同学' }
  ];
  /* 先按当前选中的身份匹配，未命中再跨身份匹配（后端本来也是由账号决定角色） */
  function matchLocal(acc, pwd) {
    var want = (loginAs === 'staff')
      ? ['doctor', 'technician', 'therapist', 'admin'] : ['patient'];
    var hit = null;
    LOCAL_ACCOUNTS.forEach(function (a) {
      if (a.acc !== acc || a.pwd !== pwd) return;
      if (!hit) hit = a;
      if (want.indexOf(a.role) >= 0) hit = a;
    });
    return hit;
  }
  function setLoginLoading(on) {
    var btn = $('#loginBtn'); if (!btn) return;
    btn.classList.toggle('loading', !!on);
    btn.disabled = !!on;
  }
  function showErr(msg) {
    var e = $('#loginErr'); if (!e) return;
    e.textContent = msg; e.classList.add('on');
  }
  function clearErr() {
    var e = $('#loginErr'); if (!e) return;
    e.textContent = ''; e.classList.remove('on');
  }
  /* 服务器连通状态：null = 未探测 / true = 可用 / false = 不可用 */
  var serverReachable = null;
  var probePromise = null;
  function paintSrv(state) {
    var el = $('#srvBadge'); if (!el) return;
    var txt = el.querySelector('span');
    el.classList.remove('ok', 'off');
    if (state === 'ok') { el.classList.add('ok'); if (txt) txt.textContent = '服务器已连接 · 数据实时同步'; }
    else if (state === 'off') { el.classList.add('off'); if (txt) txt.textContent = '服务器未连接 · 本地演示模式'; }
    else if (txt) txt.textContent = '正在连接服务器…';
  }
  /* 启动时探测一次：把「点登录后干等 10 秒超时」提前化解掉 */
  function probeServer() {
    if (!SYNC_ON || !API_BASE) { serverReachable = false; paintSrv('off'); return Promise.resolve(false); }
    if (probePromise) return probePromise;
    paintSrv('probe');
    probePromise = api('GET', '/api/model/status', null, 2600).then(function () {
      serverReachable = true; paintSrv('ok'); return true;
    }).catch(function () {
      serverReachable = false; paintSrv('off');
      probePromise = null;      // 允许下次点击时重新探测
      return false;
    });
    return probePromise;
  }
  /* 后台静默校验：本地账号先秒进，再用真实后端补 token 与真实数据；
     网络失败静默忽略（不打断演示），账号确实错误才提示 */
  function verifySilently(acc, pwd, localRole) {
    if (!SYNC_ON || !API_BASE) return;
    api('POST', '/api/auth/login', { username: acc, password: pwd }, 7000).then(function (res) {
      var d = res.data || {};
      if (!d.ok || !d.user) return;
      serverReachable = true; paintSrv('ok');
      AUTH_TOKEN = d.token || null;
      CUR_USER = d.user || null;
      saveAuth();
      var inner = ROLE_MAP[d.user.role] || localRole;
      if (inner !== localRole) {          // 账号实际角色与所选身份不一致，按后端纠正
        applyRole(inner, d.user.name);
        stack = [homeFor(inner)]; show(homeFor(inner));
      }
      if (inner === 'patient') renderPatientRemote();
      else if (inner === 'admin') renderAdminRemote();
      else renderStaffRemote();
    }).catch(function () {});
  }
  /* 本地演示登录（SYNC 关闭或后端不可达时兜底）——账号体系对齐新版网页 */
  function enterAppLocal(acc, pwd) {
    var m = matchLocal(acc, pwd);
    if (!m) {
      showErr(loginAs === 'staff'
        ? '手机号或密码错误（医护账号由管理员分发，演示密码 123456）'
        : '手机号或密码错误（患者演示账号 13700000001 / 123456）');
      return;
    }
    enterHome(m.role, m.name);
  }
  var loginLock = false;
  function enterApp() {
    var acc = ($('#phoneInput').value || '').trim();
    var pwd = ($('#codeInput').value || '').trim();
    LAST_CRED = { acc: acc, pwd: pwd };   /* 仅内存保存，供登录态丢失时静默补签 */
    clearErr();
    if (!/^\d{11}$/.test(acc)) { showErr('请输入 11 位手机号'); return; }
    if (!pwd) { showErr(loginAs === 'staff' ? '请输入登录密码' : '请输入验证码或密码'); return; }
    if (loginLock) return;

    var local = matchLocal(acc, pwd);

    /* 1) 已确认服务器不可用 → 演示账号立即进入，零等待 */
    if (serverReachable === false) {
      enterAppLocal(acc, pwd);
      if (local) toast('本地演示模式 · 数据不与服务器同步');
      probeServer();                       // 顺手再探一次，服务起来了下次点登录就联网
      return;
    }

    /* 2) 演示账号 → 先秒进，再后台补真实登录态（关键提速点） */
    if (local) {
      enterHome(local.role, local.name);
      verifySilently(acc, pwd, local.role);
      return;
    }

    /* 3) 真实注册账号 → 必须等后端鉴权 */
    loginLock = true;
    setLoginLoading(true);
    api('POST', '/api/auth/login', { username: acc, password: pwd }, 6000).then(function (res) {
      loginLock = false; setLoginLoading(false);
      var d = res.data || {};
      serverReachable = true; paintSrv('ok');
      if (d.ok && d.user) {
        AUTH_TOKEN = d.token || null;
        CUR_USER = d.user || null;
        saveAuth();
        enterHome(ROLE_MAP[d.user.role] || 'patient', d.user.name);
      } else {
        showErr(d.error || '账号或密码错误');
      }
    }).catch(function (err) {
      loginLock = false; setLoginLoading(false);
      /* 后端有响应但拒绝（4xx）：是账号密码问题，不是网络问题 */
      if (err && err.status) {
        if (err.status < 500) {
          serverReachable = true; paintSrv('ok');
          showErr((err.data && err.data.error) || '账号或密码错误');
          return;
        }
        showErr('服务器内部错误（' + err.status + '），请稍后重试');
        return;
      }
      if (local) { enterAppLocal(acc, pwd); return; }
      serverReachable = false; paintSrv('off');
      showErr('无法连接服务器，请检查网络后重试');
    });
  }
  $('#loginBtn').addEventListener('click', function () {
    if (!$('#agreeDisc').classList.contains('on')) {
      showErr('请先阅读并勾选同意《用户协议》与《隐私政策》');
      return;
    }
    enterApp();
  });
  $('#quickIn').addEventListener('click', function () {
    applyRole('patient');
    stack = ['home']; show('home'); toast('欢迎浏览演示数据');
  });
  $('#agreeRow').addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (a) { openDoc(a.dataset.doc || 'user'); return; }
    $('#agreeDisc').classList.toggle('on');
  });
  var cd = 0, cdTimer = null;
  $('#codeBtn').addEventListener('click', function () {
    if (cd > 0) return;
    /* 演示环境没有接短信通道，这里直接填演示密码，避免「填了 1234 却登不进去」的死路 */
    $('#codeInput').value = '123456';
    var ci = $('#codeInput'); if (ci) { ci.type = 'password'; }
    var eye = $('#pwdEye'); if (eye) eye.classList.remove('showing');
    toast('演示环境未接入短信 · 已填入演示密码 123456');
    cd = 60;
    var btn = this;
    btn.classList.add('off');
    btn.textContent = '60 s 后重发';
    cdTimer = setInterval(function () {
      cd--;
      if (cd <= 0) { clearInterval(cdTimer); btn.classList.remove('off'); btn.textContent = '获取验证码'; cd = 0; }
      else btn.textContent = cd + ' s 后重发';
    }, 1000);
  });

  /* ---------- 账号注册（管理员审核） ---------- */
  var regRole = '患者';
  $('#goRegister').addEventListener('click', function () { go('register'); });
  $('#regRole').addEventListener('click', function (e) {
    var b = e.target.closest('.rs'); if (!b) return;
    regRole = b.getAttribute('data-as');
    $$('.rs', this).forEach(function (x) { x.classList.toggle('on', x === b); });
  });
  function getPending() { try { return JSON.parse(localStorage.getItem('lsy_reg_pending') || '[]'); } catch (e) { return []; } }
  function setPending(a) { try { localStorage.setItem('lsy_reg_pending', JSON.stringify(a)); } catch (e) {} }

  /* 密码不落明文：演示环境做一次轻量散列，避免 localStorage 里能直接读到明文口令 */
  function hashPwd(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return 'h' + h.toString(36);
  }
  function accountExists(phone) {
    if (getPending().some(function (r) { return r.phone === phone; })) return 'pending';
    if (getApproved().some(function (r) { return r.phone === phone; })) return 'approved';
    if (allAccts().some(function (a) { return a.acct === phone || a.key === phone; })) return 'approved';
    return '';
  }
  $('#regSubmit').addEventListener('click', function () {
    var phone = ($('#regPhone').value || '').trim();
    var name = ($('#regName').value || '').trim();
    var org = ($('#regOrg') ? $('#regOrg').value : '').trim();
    var pwd = ($('#regPwd').value || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请输入正确的 11 位手机号'); return; }
    if (!name) { toast('请输入姓名'); return; }
    if (!org) { toast('请输入机构名称'); return; }
    if (pwd.length < 8) { toast('请设置 8 位以上密码'); return; }
    function doneRegister() {
      $('#regPhone').value = ''; $('#regName').value = ''; $('#regPwd').value = '';
      var o = $('#regOrg'); if (o) o.value = '';
      toast('注册申请已提交，等待管理员审核');
      stack = ['login']; show('login');
    }
    /* 同步开启时提交到后端（SQLite 落库，管理员在云端审核）；失败回落本地 */
    if (SYNC_ON) {
      api('POST', '/api/auth/register', { name: name, phone: phone, org: org, role: regRole, password: pwd }, 10000).then(function (res) {
        var d = res.data || {};
        if (d.ok) { doneRegister(); }
        else { toast(d.error || '注册失败，请重试'); }
      }).catch(function () {
        toast('注册服务暂时不可达，请稍后再试');
      });
      return;
    }
    /* 离线兜底：本地记录（演示用，无真实审核） */
    var list = getPending();
    list.push({ phone: phone, name: name, org: org, role: regRole, pw: hashPwd(pwd) });
    setPending(list);
    doneRegister();
  });
  function getApproved() { try { return JSON.parse(localStorage.getItem('lsy_reg_approved') || '[]'); } catch (e) { return []; } }
  function setApproved(a) { try { localStorage.setItem('lsy_reg_approved', JSON.stringify(a)); } catch (e) {} }
  var BASE_ACCTS = [
    { key: '88888888', av: '管', acct: '88888888', name: '系统管理员', role: 'admin', bg: 'var(--blue-l);color:var(--blue);', desc: '系统管理员 · 超级权限 · 当前账号', noDisable: true },
    { key: '13800000910', av: '王', acct: '13800000910', name: '王同学', role: 'patient', bg: '#eef2ff;color:#4f46e5;', desc: '患者 · 验证码 1234' },
    { key: 'doctor', av: '杨', acct: 'doctor', name: '杨同学', role: 'doctor', bg: '#ecfdf5;color:#059669;', desc: '执业医师' },
    { key: 'rehab', av: '张', acct: 'rehab', name: '张同学', role: 'therapist', bg: '#fff7ed;color:#d97706;', desc: '康复治疗师' },
    { key: '17600002233', av: '李', acct: '176****2233', name: '李同学', role: 'patient', bg: '#f1f5f9;color:#94a3b8;', desc: '患者 · 30 天未登录' }
  ];
  function getDisabled() {
    var d = null; try { d = JSON.parse(localStorage.getItem('lsy_reg_disabled') || 'null'); } catch (e) { d = null; }
    if (!d) { d = ['17600002233']; setDisabled(d); }
    return d;
  }
  function setDisabled(a) { try { localStorage.setItem('lsy_reg_disabled', JSON.stringify(a)); } catch (e) {} }
  function isDisabled(key) { return getDisabled().indexOf(key) !== -1; }
  function allAccts() {
    var list = BASE_ACCTS.slice();
    getApproved().forEach(function (r) {
      var staff = r.role === 'staff';
      list.push({ key: r.phone, av: r.name.slice(0, 1), acct: r.phone, name: r.name,
        role: staff ? 'doctor' : 'patient',
        bg: staff ? '#ecfdf5;color:#059669;' : '#eef2ff;color:#4f46e5;',
        desc: (staff ? '医护' : '患者') + ' · 注册账号' });
    });
    return list;
  }
  function renderAccounts() {
    var box = $('#acctBox'); if (!box) return;
    var list = allAccts(), nP = 0, nS = 0, html = '';
    list.forEach(function (a) {
      if (a.role === 'patient') nP++;
      else if (a.role === 'doctor' || a.role === 'therapist') nS++;
      var off = isDisabled(a.key);
      var tag = off ? '<span class="tag tag-off">已停用</span>' : '<span class="tag tag-on">正常</span>';
      var act = a.noDisable ? '' : (off
        ? '<span class="admin-act" data-pa="enable" data-key="' + esc(a.key) + '">启用</span>'
        : '<span class="admin-act" data-pa="disable" data-key="' + esc(a.key) + '" style="color:#dc2626;border-color:#fecaca;">停用</span>');
      html += '<div class="cell"><span class="mi" style="background:' + a.bg + '">' + esc(a.av) + '</span>' +
        '<div class="ct"><b>' + esc(a.acct) + '</b><p style="font-size:12px;color:var(--mut);">' + esc(a.name) + ' · ' + esc(a.desc) + '</p></div>' + tag + act + '</div>';
    });
    box.innerHTML = html;
    var st = function (id, v) { var e = $(id); if (e) e.textContent = v; };
    st('#statTotal', list.length); st('#statPatient', nP); st('#statStaff', nS);
  }
  function renderPending() {
    var wrap = $('#pendingWrap'), box = $('#pendingBox'), cnt = $('#pendingCount');
    if (!wrap || !box) return;
    var list = getPending();
    if (!list.length) { wrap.style.display = 'none'; box.innerHTML = ''; return; }
    wrap.style.display = '';
    if (cnt) cnt.textContent = '（' + list.length + '）';
    box.innerHTML = list.map(function (r, i) {
      var rn = r.role === 'staff' ? '医护' : '患者';
      var bg = r.role === 'staff' ? 'background:#ecfdf5;color:#059669;' : 'background:#eef2ff;color:#4f46e5;';
      return '<div class="cell"><span class="mi" style="' + bg + '">' + esc(String(r.name).slice(0, 1)) + '</span>' +
        '<div class="ct"><b>' + esc(r.name) + ' · ' + rn + '</b><p style="font-size:12px;color:var(--mut);">' + esc(r.phone) + ' · 申请注册</p></div>' +
        '<span class="admin-act" data-pa="reject" data-idx="' + i + '" style="color:#dc2626;border-color:#fecaca;margin-right:6px;">拒绝</span>' +
        '<span class="admin-act" data-pa="approve" data-idx="' + i + '">通过</span></div>';
    }).join('');
  }

  /* ---------- 远程同步：管理员 / 医护工作台 / 打卡 / 留言 ---------- */
  /* 管理员（远程）：从后端拉账号列表 + 待审核，渲染到 admin 屏 */
  function renderAdminRemote() {
    if (!SYNC_ON || serverReachable === false) return;
    /* 新版后端：真实账号清单 + 待审核注册申请，全部来自数据库 */
    api('GET', '/api/admin/users', null, 7000).then(function (res) {
      var d = res.data || {};
      if (!d.ok) return;
      var users = d.users || [];
      var box = $('#acctBox');
      if (!box) return;
      var roleTag = { '患者': '患者', '执业医师': '医师', '康复治疗师': '治疗师', '影像技师': '技师', '机构管理员': '管理员' };
      var nP = 0, nS = 0, html = '';
      users.forEach(function (a) {
        if (a.role === '患者') nP++;
        else nS++;
        var off = a.status !== 'active';
        var tag = off ? '<span class="tag tag-off">已停用</span>' : '<span class="tag tag-on">正常</span>';
        var bg = a.role === '患者' ? '#eef2ff;color:#4f46e5;' : '#ecfdf5;color:#059669;';
        html += '<div class="cell"><span class="mi" style="' + bg + '">' + esc(String(a.name || '?').slice(0, 1)) + '</span>' +
          '<div class="ct"><b>' + esc(a.phone) + '</b><p style="font-size:12px;color:var(--mut);">' + esc(a.name) + ' · ' + (roleTag[a.role] || a.role) + (a.case_count ? ' · ' + a.case_count + ' 例' : '') + '</p></div>' + tag + '</div>';
      });
      box.innerHTML = html || '<p class="small muted" style="padding:14px;text-align:center;">暂无账号</p>';
      var st = function (id, v) { var e = $(id); if (e) e.textContent = v; };
      st('#statTotal', users.length); st('#statPatient', nP); st('#statStaff', nS);
    }).catch(function () {});
    /* 待审核注册申请 */
    api('GET', '/api/admin/pending', null, 10000).then(function (res) {
      var d = res.data || {};
      if (!d.ok) return;
      var apps = d.applications || [];
      var wrap = $('#pendingWrap'), box = $('#pendingBox');
      if (!wrap || !box) return;
      wrap.style.display = apps.length ? '' : 'none';
      var html = '';
      apps.forEach(function (a) {
        html += '<div class="cell"><span class="mi" style="background:#fff7ed;color:#d97706;">' + esc(String(a.name || '?').slice(0, 1)) + '</span>' +
          '<div class="ct"><b>' + esc(a.name) + '</b><p style="font-size:12px;color:var(--mut);">' + esc(a.phone) + ' · ' + esc(a.role) + ' · ' + esc(a.org || '') + '</p></div>' +
          '<span class="admin-act" data-ra="approve" data-id="' + a.id + '" style="color:#059669;border-color:#a7f3d0;">通过</span>' +
          '<span class="admin-act" data-ra="reject" data-id="' + a.id + '" style="color:#dc2626;border-color:#fecaca;">驳回</span></div>';
      });
      box.innerHTML = html || '<p class="small muted" style="padding:14px;text-align:center;">暂无待审核申请</p>';
    }).catch(function () {});
  }
  /* ===== 医护工作台：KPI / 病例队列 / 随访提醒，全部来自后端真实库表 ===== */
  var STAFF_CASES = [];
  var STAFF_FILTER = 'todo';
  var OPEN_CASE = null;
  var PENDING_OPEN = '';   /* 新建档后待自动打开的病例号 */

  function setNum(sel, v) { var e = $(sel); if (e) e.textContent = (v == null ? 0 : v); }
  function paintLive(state) {
    var el = $('#shLive'); if (!el) return;
    var t = el.querySelector('span');
    el.classList.remove('ok', 'off');
    if (state === 'ok') { el.classList.add('ok'); if (t) t.textContent = '实时同步'; }
    else if (state === 'off') { el.classList.add('off'); if (t) t.textContent = '演示数据'; }
    else if (t) t.textContent = '同步中';
  }
  function statusBadge(st) {
    if (st === '待审核') return '<span class="badge amber">待审核</span>';
    if (st === '已驳回') return '<span class="badge red">已驳回</span>';
    if (st === '已审核') return '<span class="badge teal">已签发</span>';
    if (st === '报告撰写中') return '<span class="badge gray">撰写中</span>';
    return '<span class="badge gray">' + esc(st || '—') + '</span>';
  }
  /* ===== 角色能力矩阵：与网页端 roleMap 对齐（技师=影像分析 / 医师=审核签发 / 治疗师=康复深化） ===== */
  var ICON = {
    img:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M3 16l5-4 4 3 3-2 6 5"/></svg>',
    pen:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    clock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    alert: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
    heart: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    bell:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    plus:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    play:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-3.2-6.4"/><path d="M20 4v5h-5"/></svg>',
    list:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
  };
  function tileIcon(ic) {
    return ic === 'red' ? ICON.alert : ic === 'teal' ? ICON.heart : ic === 'amber' ? ICON.clock : ICON.img;
  }
  function actIcon(k) {
    if (k === 'add') return ICON.plus;
    if (k === 'top') return ICON.play;
    if (k === 'follow') return ICON.bell;
    if (k === 'admin') return ICON.check;
    return ICON.list;
  }

  var STAFF_CFG = {
    technician: {
      nav: '技师工作台',
      kpi: ['待写报告', '待医师复核', '已签发'],
      zone: {
        badge: '影像技师', title: '影像采集与报告',
        desc: '新建影像 → 模型初判 → 撰写检查报告 → 提交医师复核',
        acts: [{ k: 'add', t: '＋ 新建影像病例', p: 1 }, { k: 'top', t: '继续写报告' }],
        empty: '暂无待写报告的病例，可新建一例；医师驳回的病例也会回到这里',
        countSuffix: '待写',
        status: ['报告撰写中', '已驳回']
      },
      tiles: [
        { k: 'analyzed_today', lb: '今日影像', ic: 'blue' },
        { k: 'draft', lb: '待写报告', ic: 'amber' },
        { k: 'pending', lb: '待医师复核', ic: 'teal' },
        { k: 'fractures', lb: '疑似骨折', ic: 'red' }
      ],
      acts: [
        { k: 'add', t: '新建病例' },
        { k: 'top', t: '写报告' },
        { k: 'filter:待审核', t: '待复核' },
        { k: 'filter:已审核', t: '已签发' }
      ],
      filters: [
        { k: 'todo', t: '待写报告' }, { k: '已驳回', t: '已驳回' },
        { k: '待审核', t: '待医师复核' }, { k: '已审核', t: '已签发' }, { k: 'all', t: '全部' }
      ]
    },
    doctor: {
      nav: '医师工作台',
      kpi: ['待我复核', '报告撰写中', '已签发'],
      zone: {
        badge: '执业医师', title: '复核与签发',
        desc: '技师提交后进入队列：AI 生成意见 → 人工核对修改 → 签发同步患者端 / 驳回',
        acts: [{ k: 'top', t: '开始审核', p: 1 }, { k: 'filter:已审核', t: '签发记录' }],
        empty: '待审核队列已清空，技师提交新报告后会实时出现在这里',
        countSuffix: '待审核',
        status: ['待审核']
      },
      tiles: [
        { k: 'pending', lb: '待我复核', ic: 'amber' },
        { k: 'draft', lb: '技师撰写中', ic: 'blue' },
        { k: 'fractures', lb: '疑似骨折', ic: 'red' },
        { k: 'confirmed', lb: '累计签发', ic: 'teal' }
      ],
      acts: [
        { k: 'top', t: '开始审核' },
        { k: 'filter:报告撰写中', t: '待提交' },
        { k: 'filter:已审核', t: '签发记录' },
        { k: 'filter:all', t: '全部病例' }
      ],
      filters: [
        { k: 'todo', t: '待我复核' }, { k: '报告撰写中', t: '技师撰写中' },
        { k: '已审核', t: '已签发' }, { k: 'all', t: '全部' }
      ]
    },
    therapist: {
      nav: '治疗师工作台',
      kpi: ['待深化方案', '康复在管', '已签发'],
      zone: {
        badge: '康复治疗师', title: '康复深化与随访',
        desc: '医师签发后制定分期康复方案（AI 初稿 → 人工修改）→ 写入档案 → 周期随访与回归评估',
        acts: [{ k: 'top', t: '制定康复方案', p: 1 }, { k: 'follow', t: '随访提醒' }],
        empty: '暂无已签发病例，医师签发后会出现在这里',
        countSuffix: '已签发',
        status: ['已审核']
      },
      tiles: [
        { k: 'to_deepen', lb: '待深化方案', ic: 'amber' },
        { k: 'in_rehab', lb: '康复在管', ic: 'teal' },
        { k: 'followups_due', lb: '随访到期', ic: 'red' },
        { k: 'confirmed', lb: '已签发', ic: 'blue' }
      ],
      acts: [
        { k: 'top', t: '制定方案' },
        { k: 'follow', t: '随访提醒' },
        { k: 'filter:已审核', t: '已签发' },
        { k: 'filter:all', t: '全部病例' }
      ],
      filters: [
        { k: 'todo', t: '待深化' }, { k: '已审核', t: '已签发' }, { k: 'all', t: '全部' }
      ]
    }
  };
  STAFF_CFG.admin = {
    nav: '机构工作台',
    kpi: ['待办事项', '在管病例', '已签发'],
    zone: {
      badge: '机构管理员', title: '机构与账号运维',
      desc: '账号开通与停用、注册申请审核、病例绑定；业务数据由医护各自处理',
      acts: [{ k: 'admin', t: '账号管理', p: 1 }, { k: 'filter:all', t: '全部病例' }],
      empty: '暂无需要处理的机构事务',
      status: []
    },
    tiles: [
      { k: 'pending', lb: '待审核病例', ic: 'amber' },
      { k: 'in_rehab', lb: '康复在管', ic: 'teal' },
      { k: 'confirmed', lb: '已签发', ic: 'blue' },
      { k: 'fractures', lb: '疑似骨折', ic: 'red' }
    ],
    acts: [
      { k: 'admin', t: '账号管理' },
      { k: 'filter:all', t: '全部病例' },
      { k: 'filter:待审核', t: '待审核' },
      { k: 'filter:已审核', t: '已签发' }
    ],
    filters: [
      { k: 'todo', t: '待处理' }, { k: '待审核', t: '待审核' },
      { k: '已审核', t: '已签发' }, { k: 'all', t: '全部' }
    ]
  };
  function staffCfg() { return STAFF_CFG[currentRole] || STAFF_CFG.doctor; }

  /* 「待处理」按角色语义收敛：医师看待审核、技师看带补报告、治疗师看已签发待深化 */
  function todoStatus() {
    if (currentRole === 'doctor')     return ['待审核'];
    if (currentRole === 'technician') return ['报告撰写中', '已驳回'];
    if (currentRole === 'therapist')  return ['已审核'];
    return ['待审核', '报告撰写中', '已驳回'];
  }
  /* 概览数字：全部取自后端 /api/summary，离线时只有本地建档数 */
  var STAFF_SUM = {};
  function tileVal(k) {
    var s = STAFF_SUM || {};
    if (k === 'to_deepen') {
      /* 待深化 = 医师已签发、但康复方案还没写的那批（比 confirmed-in_rehab 更准） */
      return STAFF_CASES.filter(function (c) {
        return c.status === '已审核' && !String(c.rehab_advice || '').trim();
      }).length;
    }
    return Number(s[k]) || 0;
  }
  function paintStaffTiles() {
    $$('#shTiles [data-tile]').forEach(function (el) {
      el.textContent = tileVal(el.getAttribute('data-tile'));
    });
  }
  /* 头部 / 四宫格 / 快捷操作 / 筛选：只在角色切换时重建一次，数字后续单独刷新 */
  var STAFF_CHROME_ROLE = '';
  function renderStaffChrome() {
    var cfg = staffCfg();
    var nav = $('#shNavTitle'); if (nav) nav.textContent = cfg.nav;
    ['#shKpiLb1', '#shKpiLb2', '#shKpiLb3'].forEach(function (sel, i) {
      var e = $(sel); if (e) e.textContent = cfg.kpi[i];
    });
    var nm = $('#shName'), av = $('#shAv');
    if (nm && av) av.textContent = String(nm.textContent || '医').slice(0, 1);

    var tg = $('#shTiles');
    if (tg) {
      tg.innerHTML = cfg.tiles.map(function (t) {
        var cls = t.ic === 'blue' ? '' : t.ic;
        return '<div class="sh-tile"><div class="sh-tile-h"><span class="sh-ic ' + t.ic + '">' + tileIcon(t.ic) + '</span>' + esc(t.lb) + '</div>' +
               '<b class="' + cls + '" data-tile="' + esc(t.k) + '">0</b></div>';
      }).join('');
    }
    var ag = $('#shActs');
    if (ag) {
      ag.innerHTML = cfg.acts.map(function (a) {
        return '<button class="sh-act" type="button" data-sact="' + esc(a.k) + '"><span class="sh-act-ic">' + actIcon(a.k) + '</span><b>' + esc(a.t) + '</b></button>';
      }).join('');
    }
    var at = $('#shActTitle'); if (at) at.textContent = cfg.actsTitle || '快捷操作';
    var fg = $('#shFilter');
    if (fg) {
      fg.innerHTML = cfg.filters.map(function (f, i) {
        return '<button class="sh-t' + (i === 0 ? ' on' : '') + '" type="button" data-f="' + esc(f.k) + '">' + esc(f.t) + '</button>';
      }).join('');
      STAFF_FILTER = 'todo';
    }
    STAFF_CHROME_ROLE = currentRole;
    paintStaffTiles();
  }
  /* 角色待办：技师=待写/被驳回、医师=待审核、治疗师=已签发（未写方案的排前面） */
  function staffTodoList() {
    if (currentRole === 'therapist') {
      return STAFF_CASES.filter(function (c) { return c.status === '已审核'; }).sort(function (a, b) {
        var av = String(a.rehab_advice || '').trim() ? 1 : 0;
        var bv = String(b.rehab_advice || '').trim() ? 1 : 0;
        return av - bv;
      });
    }
    var want = staffCfg().zone.status || [];
    if (!want.length) return [];
    return STAFF_CASES.filter(function (c) { return want.indexOf(c.status) >= 0; });
  }
  function renderStaffZone() {
    var box = $('#shZone'); if (!box) return;
    var z = staffCfg().zone;
    var list = staffTodoList();
    var rows = list.slice(0, 3).map(function (c) {
      var st = c.status || '';
      var cls = st === '待审核' ? 'amber' : (st === '已驳回' ? 'red' : (st === '已审核' ? 'teal' : ''));
      var right;
      if (currentRole === 'therapist') {
        right = String(c.rehab_advice || '').trim()
          ? '<span class="sh-ztag teal">方案已写入</span>'
          : '<span class="sh-ztag amber">待深化</span>';
      } else {
        right = '<span class="sh-zone-go">处理 ›</span>';
      }
      return '<div class="sh-case" data-case="' + esc(c.case_no || '') + '">' +
        '<div class="sh-case-av ' + cls + '">' + esc(String(c.patient_name || '患').slice(0, 1)) + '</div>' +
        '<div class="sh-case-b"><b>' + esc(c.patient_name || '未命名') + ' · ' + esc(c.part || '未填部位') + '</b>' +
        '<span>' + esc(c.case_no || '') + ' · ' + esc(c.modality || '—') + (c.local ? ' · 本地演示' : '') + '</span></div>' +
        right + '</div>';
    }).join('');
    box.innerHTML =
      '<div class="sh-zone-hd"><span class="sh-zone-bd">' + esc(z.badge) + '</span>' +
        '<b class="sh-zone-t">' + esc(z.title) + '</b>' +
        '<span class="sh-zone-n">' + list.length + ' 例' + esc(z.countSuffix || '') + '</span></div>' +
      '<p class="sh-zone-d">' + esc(z.desc) + '</p>' +
      '<div class="sh-zone-acts">' + z.acts.map(function (a) {
        return '<button class="sh-zbtn' + (a.p ? ' primary' : '') + '" type="button" data-zact="' + esc(a.k) + '">' + esc(a.t) + '</button>';
      }).join('') + '</div>' +
      (rows ? '<div class="sh-zone-list">' + rows + '</div>' : '<p class="sh-empty" style="padding:16px 4px;">' + esc(z.empty) + '</p>');
  }
  function setStaffFilter(f) {
    STAFF_FILTER = f || 'todo';
    var box = $('#shFilter');
    if (box) $$('.sh-t', box).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-f') === STAFF_FILTER); });
    renderStaffQueue();
  }
  /* 角色工作区的按钮：不做无权限的跳转，全部落在当前身份能做的事上 */
  function staffAct(k) {
    if (!k) return;
    if (k === 'add') { openAddCase(); return; }
    if (k === 'admin') { go('admin'); return; }
    if (k === 'follow') {
      var fc = $('#shFollowCard');
      if (fc && fc.style.display !== 'none') { fc.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('已定位到随访提醒'); }
      else toast('当前没有到期的随访');
      return;
    }
    if (k.indexOf('filter:') === 0) { setStaffFilter(k.slice(7)); return; }
    if (k === 'top') {
      var list = staffTodoList();
      if (!list.length) { toast(staffCfg().zone.empty); return; }
      openCaseModal(list[0].case_no);
    }
  }
  function renderStaffQueue() {
    var box = $('#shQueue'); if (!box) return;
    renderStaffZone();
    paintStaffTiles();
    var cnt = $('#shQueueCnt');
    var list;
    if (STAFF_FILTER === 'all') {
      list = STAFF_CASES.slice();
    } else if (STAFF_FILTER === 'todo') {
      var want = todoStatus();
      list = STAFF_CASES.filter(function (c) { return want.indexOf(c.status) >= 0; });
    } else {
      list = STAFF_CASES.filter(function (c) { return c.status === STAFF_FILTER; });
    }
    if (cnt) cnt.textContent = list.length + ' 例 ›';
    if (!list.length) {
      var hint = currentRole === 'technician'
        ? '暂无待写报告的病例，可切到「全部」查看历史病例'
        : currentRole === 'therapist'
          ? '暂无待深化方案的病例，医师签发后会出现在这里'
          : '技师提交检查报告后会实时出现在这里';
      box.innerHTML = '<p class="sh-empty">当前分类暂无病例<br><span style="font-size:11px;">' + hint + '</span></p>';
      return;
    }
    var html = '';
    list.slice(0, 15).forEach(function (c) {
      var st = c.status || '';
      var cls = st === '待审核' ? 'amber' : (st === '已驳回' ? 'red' : (st === '已审核' ? 'teal' : ''));
      var conf = Math.round((Number(c.confidence) || 0) * 100);
      var sub = esc(c.case_no || '') + ' · ' + esc(c.modality || '—') +
                (c.local ? ' · 本地演示' : (' · AI ' + conf + '%'));
      html += '<div class="sh-case" data-case="' + esc(c.case_no || '') + '">' +
        '<div class="sh-case-av ' + cls + '">' + esc(String(c.patient_name || '患').slice(0, 1)) + '</div>' +
        '<div class="sh-case-b"><b>' + esc(c.patient_name || '未命名') + ' · ' + esc(c.part || '未填部位') + '</b>' +
        '<span>' + sub + '</span></div>' +
        statusBadge(st) + '</div>';
    });
    box.innerHTML = html;
  }

  /* ---------- 新增病例：医护端主动建档（可选随附影像跑 AI 初判） ---------- */
  var AC_PARTS = ['腕部（桡骨远端）', '踝部（外踝）', '锁骨（中段）', '胫腓骨（下段）', '膝部（髌骨）'];
  var AC = { part: AC_PARTS[0], modality: 'X光', img: null };

  function acPartValue() {
    if (AC.part === '__other__') {
      var o = $('#acPartOther');
      return o && o.value ? String(o.value).trim() : '';
    }
    return AC.part;
  }
  function acRefreshImg() {
    var tip = $('#acUpTip'), btn = $('#acPick');
    if (!tip) return;
    if (AC.img) {
      tip.innerHTML = '<b>' + esc(AC.img.name) + '</b>' + esc(AC.img.sizeText) + ' · 建档时自动跑 AI 初判';
      if (btn) btn.classList.add('picked');
    } else {
      tip.innerHTML = '可选，上传后自动跑 AI 初判';
      if (btn) btn.classList.remove('picked');
    }
  }
  /* 读图 → 等比压缩到 1400px 以内（移动端原图 4–8MB，压完约 200KB，模型照样能判） */
  function acReadImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('未选择影像')); return; }
      if (!/^image\//i.test(file.type || '')) { reject(new Error('只支持 JPG / PNG 图片')); return; }
      if (file.size > 12 * 1024 * 1024) { reject(new Error('影像超过 12MB，请先压缩再上传')); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('读取影像失败')); };
      fr.onload = function () {
        var dataUrl = String(fr.result || '');
        var img = new Image();
        img.onerror = function () { resolve(dataUrl); };
        img.onload = function () {
          try {
            var max = 1400, w = img.width, h = img.height;
            if (w > max || h > max) {
              var k = Math.min(max / w, max / h);
              w = Math.max(1, Math.round(w * k));
              h = Math.max(1, Math.round(h * k));
            }
            var cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            var out = cv.toDataURL('image/jpeg', 0.86);
            resolve(out && out.length > 200 ? out : dataUrl);
          } catch (e) { resolve(dataUrl); }
        };
        img.src = dataUrl;
      };
      fr.readAsDataURL(file);
    });
  }
  /* 离线判定：同步开关关 / 没配后端 / 探测失败，都按离线处理 */
  function offlineMode() { return !SYNC_ON || !API_BASE || serverReachable === false; }

  /* ---------- 本地演示病例（离线建档）：只落 localStorage，不上传影像 ---------- */
  var LOCAL_CASE_KEY = 'lsy_local_cases';
  function acPad2(n) { return (n < 10 ? '0' : '') + n; }
  function loadLocalCases() {
    try {
      var list = JSON.parse(localStorage.getItem(LOCAL_CASE_KEY) || '[]');
      return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
    } catch (e) { return []; }
  }
  function saveLocalCases(list) {
    try { localStorage.setItem(LOCAL_CASE_KEY, JSON.stringify((list || []).slice(0, 60))); } catch (e) {}
  }
  function newLocalCaseNo() {
    var d = new Date();
    var ymd = '' + d.getFullYear() + acPad2(d.getMonth() + 1) + acPad2(d.getDate());
    var n = 0;
    loadLocalCases().forEach(function (c) {
      if (String((c && c.case_no) || '').indexOf('LOCAL-' + ymd + '-') === 0) n++;
    });
    return 'LOCAL-' + ymd + '-' + ('00' + (n + 1)).slice(-3);
  }
  function localDraftCount() {
    var n = 0;
    loadLocalCases().forEach(function (c) { if (c && c.status === '报告撰写中') n++; });
    return n;
  }
  /* 离线时 KPI 全为 0，本地建档的病例只影响「报告撰写中」与「今日影像」 */
  function paintStaffOfflineKpi() {
    setNum('#shKpiPending', 0); setNum('#shKpiDraft', 0); setNum('#shKpiDone', 0);
    bumpLocalKpi();
  }
  function bumpLocalKpi() {
    var n = localDraftCount();
    if (!n) return;
    var cur = function (sel) { var e = $(sel); return e ? (Number(e.textContent) || 0) : 0; };
    if (currentRole === 'technician') setNum('#shKpiPending', cur('#shKpiPending') + n);
    else if (currentRole === 'doctor') setNum('#shKpiDraft', cur('#shKpiDraft') + n);
    /* 概览四宫格同步把本地病例算进去，避免「队列里有、卡片却是 0」 */
    STAFF_SUM.draft = (Number(STAFF_SUM.draft) || 0) + n;
    STAFF_SUM.analyzed_today = (Number(STAFF_SUM.analyzed_today) || 0) + n;
    paintStaffTiles();
  }
  function openPendingCase() {
    if (!PENDING_OPEN) return;
    var no = PENDING_OPEN, hit = null;
    PENDING_OPEN = '';
    STAFF_CASES.forEach(function (x) { if (x.case_no === no) hit = x; });
    if (hit) openCaseModal(no);
  }

  /* 演示账号「秒进」时 token 可能还没回来（或登录态过期），点操作前先静默补签一次 */
  var LAST_CRED = null;
  function ensureAuth() {
    if (AUTH_TOKEN) return Promise.resolve(true);
    if (!SYNC_ON || !API_BASE) return Promise.resolve(false);
    var c = LAST_CRED;
    if (!c) {
      LOCAL_ACCOUNTS.forEach(function (a) { if (!c && a.role === currentRole) c = { acc: a.acc, pwd: a.pwd }; });
    }
    if (!c) return Promise.resolve(false);
    return api('POST', '/api/auth/login', { username: c.acc, password: c.pwd }, 8000).then(function (res) {
      var d = res.data || {};
      if (d.ok && d.token) {
        AUTH_TOKEN = d.token; CUR_USER = d.user || CUR_USER; saveAuth();
        serverReachable = true; paintSrv('ok');
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  function openAddCase() {
    if (offlineMode()) { acRenderForm(true); return; }
    if (!AUTH_TOKEN) {
      toast('正在校验登录态…');
      ensureAuth().then(function (ok) {
        if (ok) { acRenderForm(false); return; }
        serverReachable = false; paintSrv('off');
        acRenderForm(true);
      });
      return;
    }
    acRenderForm(false);
  }
  function acRenderForm(off) {
    AC = { part: AC_PARTS[0], modality: 'X光', img: null, offline: !!off };
    var partChips = AC_PARTS.map(function (p, i) {
      var short = p.replace(/（.*$/, '');
      var tail = p.indexOf('（') >= 0 ? p.slice(p.indexOf('（') + 1, -1) : '';
      return '<button class="ac-chip' + (i === 0 ? ' on' : '') + '" type="button" data-ap="' + esc(p) + '">' +
             esc(short) + (tail ? '·' + esc(tail) : '') + '</button>';
    }).join('') + '<button class="ac-chip" type="button" data-ap="__other__">其他</button>';
    var modChips = ['X光', 'CT', 'MRI', '超声'].map(function (m, i) {
      return '<button class="ac-chip' + (i === 0 ? ' on' : '') + '" type="button" data-am="' + m + '">' + m + '</button>';
    }).join('');
    var html = '<div class="sh-modal ac-form">' +
      '<h4>新增病例</h4>' +
      '<div class="sh-mno">' + (off
        ? '未连接服务器 · 建档只保存在本机，联网后可正式建档'
        : '建档后进入「报告撰写中」，由影像技师补影像与检查报告') + '</div>' +
      '<label class="ac-lb">患者姓名<em>*</em></label>' +
      '<input class="ac-inp" id="acName" type="text" maxlength="20" placeholder="如 王同学" autocomplete="off">' +
      '<label class="ac-lb">患者手机号</label>' +
      '<input class="ac-inp" id="acPhone" type="tel" maxlength="11" placeholder="填写后患者端可查看该病例（可留空）">' +
      '<label class="ac-lb">检查部位<em>*</em></label>' +
      '<div class="ac-chips" id="acPartChips">' + partChips + '</div>' +
      '<input class="ac-inp" id="acPartOther" type="text" maxlength="40" placeholder="填写部位，如 肘部（鹰嘴）" style="display:none;margin-top:8px;">' +
      '<label class="ac-lb">影像类型</label>' +
      '<div class="ac-chips" id="acModChips">' + modChips + '</div>' +
      '<label class="ac-lb">受伤日期</label>' +
      '<input class="ac-inp" id="acDate" type="date">' +
      '<label class="ac-lb">运动项目</label>' +
      '<input class="ac-inp" id="acSport" type="text" maxlength="20" placeholder="如 篮球（可留空）">' +
      '<label class="ac-lb">主诉 / 现病史</label>' +
      '<textarea id="acChief" maxlength="300" placeholder="如 打篮球落地时左腕撑地，疼痛肿胀 2 小时…"></textarea>' +
      (off ? '' :
        '<label class="ac-lb">随附影像</label>' +
        '<div class="ac-upload">' +
          '<input type="file" id="acFile" accept="image/*" style="display:none;">' +
          '<button class="ac-upbtn" type="button" id="acPick">选择 JPG / PNG</button>' +
          '<span class="ac-uptip" id="acUpTip">可选，上传后自动跑 AI 初判</span>' +
        '</div>') +
      '<p class="ac-hint">' + (off
        ? '离线建档不会上传影像、也不会跑 AI 初判；连接后端后重新建档即可获得模型结果与完整复核流程。'
        : '建档只生成病例与初判，影像报告仍需技师核对提交、执业医师签发后才会同步到患者端。') + '</p>' +
      '<div class="sh-macts">' +
        '<button class="btn btn-ghost" type="button" id="acCancel">取消</button>' +
        '<button class="btn btn-primary" type="button" id="acSubmit">' + (off ? '本地建档' : '建档') + '</button>' +
      '</div>' +
      '</div>';
    openModal(html);
    var fi = $('#acFile');
    if (fi) {
      fi.addEventListener('change', function () {
        var f = fi.files && fi.files[0];
        if (!f) return;
        var tip = $('#acUpTip');
        if (tip) tip.textContent = '影像处理中…';
        acReadImage(f).then(function (dataUrl) {
          AC.img = {
            name: f.name || '影像.jpg',
            sizeText: ' · ' + Math.max(1, Math.round(f.size / 1024)) + 'KB',
            b64: String(dataUrl).split(',')[1] || ''
          };
          acRefreshImg();
        }).catch(function (err) {
          toast((err && err.message) || '读取影像失败');
          acRefreshImg();
        });
      });
    }
  }
  /* 本地建档：写 localStorage，队列与 KPI 立即反映，不发网络请求 */
  function acSaveLocal(payload) {
    var d = new Date();
    var iso = d.getFullYear() + '-' + acPad2(d.getMonth() + 1) + '-' + acPad2(d.getDate()) + 'T' +
              acPad2(d.getHours()) + ':' + acPad2(d.getMinutes()) + ':' + acPad2(d.getSeconds());
    var c = {
      case_no: newLocalCaseNo(),
      patient_name: payload.patient_name,
      patient_phone: payload.patient_phone || '',
      part: payload.part,
      modality: payload.modality || 'X光',
      sport: payload.sport || '未填写',
      injury_date: payload.injury_date || '',
      chief_complaint: payload.chief_complaint || '',
      confidence: 0,
      finding_label: '待上传影像',
      stage: '保护期',
      status: '报告撰写中',
      created_at: iso,
      tech_name: '', doctor_name: '',
      local: true
    };
    var list = loadLocalCases();
    list.unshift(c);
    saveLocalCases(list);
    closeModal();
    toast('已本地建档 ' + c.case_no + ' · 未连接服务器，暂不同步');
    STAFF_FILTER = 'all';
    $$('.sh-t').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-f') === 'all'); });
    PENDING_OPEN = c.case_no;
    renderStaffRemote();
  }
  function acSubmitCase() {
    var name = (($('#acName') || {}).value || '').trim();
    var phone = (($('#acPhone') || {}).value || '').trim();
    var part = acPartValue();
    if (!name) { toast('请填写患者姓名'); var n0 = $('#acName'); if (n0) n0.focus(); return; }
    if (!part) { toast('请选择或填写检查部位'); var p0 = $('#acPartOther'); if (p0) p0.focus(); return; }
    if (phone && !/^1\d{10}$/.test(phone)) { toast('患者手机号应为 11 位数字'); return; }
    var dEl = $('#acDate');
    var payload = {
      patient_name: name,
      patient_phone: phone,
      part: part,
      modality: AC.modality,
      sport: (($('#acSport') || {}).value || '').trim(),
      injury_date: (dEl && dEl.value) ? dEl.value : '',
      chief_complaint: (($('#acChief') || {}).value || '').trim(),
      image_b64: AC.img ? AC.img.b64 : ''
    };
    /* 离线（或登录态补签失败）：直接本地建档，不让用户卡在“请先登录” */
    if (AC.offline || offlineMode() || !AUTH_TOKEN) { acSaveLocal(payload); return; }
    var btn = $('#acSubmit');
    if (btn) { btn.disabled = true; btn.textContent = AC.img ? 'AI 判读中…' : '建档中…'; }
    var restore = function () { if (btn) { btn.disabled = false; btn.textContent = '建档'; } };
    api('POST', '/api/cases', payload, 60000).then(function (res) {
      var d = res.data || {};
      if (!d.ok) { toast(d.error || '建档失败'); restore(); return; }
      closeModal();
      var tip = '已建档 ' + (d.case_no || '');
      if (d.ai_used) tip += ' · AI 初判：' + (d.finding_label || '') + ' ' + Math.round((Number(d.confidence) || 0) * 100) + '%';
      toast(tip);
      if (d.warning) setTimeout(function () { toast(d.warning); }, 1900);
      STAFF_FILTER = 'all';
      $$('.sh-t').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-f') === 'all'); });
      PENDING_OPEN = d.case_no || '';
      renderStaffRemote();
    }).catch(function (err) {
      /* 纯网络失败（没有 HTTP 状态）→ 退回本地建档，保证按钮始终可用 */
      if (err && !err.status) { acSaveLocal(payload); return; }
      toast((err && err.data && err.data.error) || '建档失败，请稍后重试');
      restore();
    });
  }

  /* ---------- 病例详情弹窗：按角色给出可执行动作 ---------- */
  /* 输入框 → 排版预览块 的映射：编辑框放纯文本，旁边实时渲染出医师端/患者端看到的版式 */
  var PV_MAP = { shTaTech: 'shPvTech', shTaCond: 'shPvCond', shTaAdvice: 'shPvAdvice', shTaRehab: 'shPvRehab' };
  function refreshMdPv() {
    Object.keys(PV_MAP).forEach(function (taId) {
      var ta = $('#' + taId), pv = $('#' + PV_MAP[taId]);
      if (!ta || !pv) return;
      var v = String(ta.value || '').trim();
      if (!v) { pv.style.display = 'none'; pv.innerHTML = ''; return; }
      pv.style.display = '';
      pv.innerHTML = '<div class="sh-mdpv-h">排版预览 · 患者端将这样显示</div>' + aiMd(v);
    });
  }
  function caseOpsHtml(c) {
    if (c.local) {
      return '<div class="sh-mbox">本地演示病例：仅保存在本机，未同步到服务器。' +
             '连接后端后重新建档，即可走「技师提交 → 医师签发 → 康复深化」的完整流程。</div>';
    }
    var st = c.status || '';
    var ops = '';
    if (currentRole === 'doctor') {
      if (st === '待审核') {
        ops = '<div class="sh-mia"><textarea id="shTaCond" placeholder="病情情况（部位 + 模型提示 + 置信度，1–3 句）"></textarea>' +
              '<div class="sh-mdpv" id="shPvCond" style="display:none;"></div></div>' +
              '<div class="sh-mia"><textarea id="shTaAdvice" placeholder="治疗建议（制动 / 复查 / 转诊方向，不写药品剂量）"></textarea>' +
              '<div class="sh-mdpv" id="shPvAdvice" style="display:none;"></div></div>' +
              '<div class="sh-macts"><button class="btn btn-ghost" type="button" data-cact="ai-review">AI 生成意见</button>' +
              '<button class="btn btn-primary" type="button" data-cact="confirm">确认签发</button></div>' +
              '<div class="sh-macts" style="margin-top:8px;"><button class="btn btn-ghost" type="button" data-cact="reject" style="color:#dc2626;">驳回给技师</button></div>';
      } else if (st === '已审核') {
        ops = '<div class="sh-mbox">该病例已于 ' + esc(String(c.reviewed_at || '').replace('T', ' ').slice(0, 16)) + ' 由 ' + esc(c.doctor_name || '医师') + ' 签发，患者端已同步。如需修改需机构管理员撤回。</div>';
      } else {
        ops = '<div class="sh-mbox">技师尚未提交检查报告，提交后会自动进入你的待审核队列。</div>';
      }
    } else if (currentRole === 'technician') {
      if (st === '报告撰写中' || st === '已驳回') {
        ops = (st === '已驳回' && c.reject_reason ? '<div class="sh-mbox" style="background:#fef2f2;border-color:#fee2e2;color:#b91c1c;">驳回原因：' + esc(c.reject_reason) + '</div>' : '') +
              '<div class="sh-mia"><textarea id="shTaTech" placeholder="检查报告：体位与曝光、图像质量、模型提示与人工核对结论">' + esc(plainText(c.tech_report || '')) + '</textarea>' +
              '<div class="sh-mdpv" id="shPvTech" style="display:none;"></div></div>' +
              '<div class="sh-macts"><button class="btn btn-ghost" type="button" data-cact="tech-ai">AI 起草</button>' +
              '<button class="btn btn-primary" type="button" data-cact="tech-submit">提交审核</button></div>';
      } else {
        ops = '<div class="sh-mbox">报告已提交，等待执业医师复核签发。</div>';
      }
    } else if (currentRole === 'therapist') {
      if (st === '已审核') {
        ops = '<div class="sh-mia"><textarea id="shTaRehab" placeholder="康复建议：分期目标、训练动作与频次、禁忌与复评节点">' + esc(plainText(c.rehab_advice || '')) + '</textarea>' +
              '<div class="sh-mdpv" id="shPvRehab" style="display:none;"></div></div>' +
              '<div class="sh-macts"><button class="btn btn-ghost" type="button" data-cact="rehab-ai">AI 生成方案</button>' +
              '<button class="btn btn-primary" type="button" data-cact="rehab-save">保存方案</button></div>';
      } else {
        ops = '<div class="sh-mbox">该病例尚未通过医师审核，签发后才能写入康复方案。</div>';
      }
    }
    return ops;
  }
  function openCaseModal(caseNo) {
    var c = null;
    STAFF_CASES.forEach(function (x) { if (x.case_no === caseNo) c = x; });
    if (!c) return;
    OPEN_CASE = c;
    var conf = Math.round((Number(c.confidence) || 0) * 100);
    var html = '<div class="sh-modal">' +
      '<h4>' + esc(c.patient_name || '未命名') + ' · ' + esc(c.part || '未填部位') + '</h4>' +
      '<div class="sh-mno">' + esc(c.case_no || '') + '</div>' +
      '<div style="margin:9px 0 4px;">' + statusBadge(c.status) + '</div>' +
      '<div class="sh-mrow"><span>影像类型</span><b>' + esc(c.modality || '—') + '</b></div>' +
      '<div class="sh-mrow"><span>运动项目</span><b>' + esc(c.sport || '—') + '</b></div>' +
      (c.injury_date ? '<div class="sh-mrow"><span>受伤日期</span><b>' + esc(c.injury_date) + '</b></div>' : '') +
      '<div class="sh-mrow"><span>AI 提示</span><b>' + esc(c.finding_label || '未检出') + ' · ' + conf + '%</b></div>' +
      '<div class="sh-mrow"><span>影像技师</span><b>' + esc(c.tech_name || '—') + '</b></div>' +
      '<div class="sh-mrow"><span>责任医师</span><b>' + esc(c.doctor_name || '待指派') + '</b></div>' +
      '<div class="sh-mrow"><span>建档时间</span><b>' + esc(String(c.created_at || '').replace('T', ' ').slice(0, 16)) + '</b></div>' +
      (c.chief_complaint ? '<div class="sh-mbox"><b>主诉：</b>' + esc(c.chief_complaint) + '</div>' : '') +
      '<div class="sh-mbox" id="shCaseBody">正在读取完整档案…</div>' +
      '<div id="shCaseOps">' + caseOpsHtml(c) + '</div>' +
      '</div>';
    openModal(html);
    refreshMdPv();
    if (c.local) {
      var b0 = $('#shCaseBody');
      if (b0) b0.innerHTML = '本地演示病例，暂无技师报告与随访记录；连接后端后建档才会有模型初判与完整档案。';
      return;
    }
    api('GET', '/api/cases/' + encodeURIComponent(caseNo) + '/full', null, 9000).then(function (res) {
      var d = res.data || {};
      var body = $('#shCaseBody'); if (!body || !d.ok) return;
      var k = d.case || {};
      var lines = [];
      var rpt = function (t, v) {
        if (!v) return;
        lines.push('<div class="sh-mdpv sh-rpt"><div class="sh-mdpv-h">' + t + '</div>' + aiMd(v) + '</div>');
      };
      rpt('技师报告', k.tech_report);
      rpt('医师结论', k.doctor_report);
      rpt('治疗建议', k.doctor_advice);
      rpt('康复方案', k.rehab_advice);
      var fu = (d.followups || []).slice(-3);
      if (fu.length) {
        lines.push('<div class="sh-mdpv sh-rpt"><div class="sh-mdpv-h">最近随访</div>' + fu.map(function (f) {
          return '<div class="ai-li">' + esc(f.record_date || '') + ' 疼痛 ' + (f.pain_score == null ? '-' : f.pain_score) +
                 ' / ROM ' + (f.rom == null ? '-' : f.rom) + '</div>';
        }).join('') + '</div>');
      }
      body.innerHTML = lines.length ? lines.join('') : '暂无报告与随访记录，可先由技师撰写检查报告。';
    }).catch(function () {
      var body = $('#shCaseBody'); if (body) body.textContent = '完整档案读取失败（网络或权限问题）';
    });
  }
  function caseAiFill(kind) {
    if (!OPEN_CASE) return;
    var no = OPEN_CASE.case_no;
    var btn = $('[data-cact="' + kind + '"]');
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    var restore = function (t) { if (btn) { btn.disabled = false; btn.textContent = t; } };
    if (kind === 'ai-review') {
      api('POST', '/api/cases/' + encodeURIComponent(no) + '/ai-review', {}, 45000).then(function (res) {
        var d = res.data || {};
        var s = d.suggestion || {};
        if (s.condition) { var a = $('#shTaCond'); if (a) a.value = plainText(s.condition); }
        if (s.advice) { var b = $('#shTaAdvice'); if (b) b.value = plainText(s.advice); }
        refreshMdPv();
        toast(d.ai_used ? 'AI 已生成复核意见，请核对后签发' : '已用本地规则生成初稿，请核对');
        restore('AI 生成意见');
      }).catch(function (err) {
        toast((err && err.data && err.data.error) || 'AI 生成失败，请检查网络');
        restore('AI 生成意见');
      });
    } else if (kind === 'tech-ai') {
      api('POST', '/api/cases/' + encodeURIComponent(no) + '/ai-review', {}, 45000).then(function (res) {
        var s = (res.data || {}).suggestion || {};
        var t = $('#shTaTech');
        if (t) t.value = '检查体位与曝光符合规范，图像质量满足判读。\n模型提示：' + (OPEN_CASE.finding_label || '未检出') +
          '，置信度 ' + Math.round((Number(OPEN_CASE.confidence) || 0) * 100) + '%。\n' +
          '人工核对：' + plainText(s.condition || '待补充');
        refreshMdPv();
        toast('已生成报告草稿，请核对后提交');
        restore('AI 起草');
      }).catch(function () { toast('AI 起草失败，请手写报告'); restore('AI 起草'); });
    } else if (kind === 'rehab-ai') {
      api('POST', '/api/cases/' + encodeURIComponent(no) + '/ai-rehab', {}, 45000).then(function (res) {
        var d = res.data || {};
        var txt = d.advice || d.plan || d.content || (d.suggestion && (d.suggestion.advice || d.suggestion.plan)) || '';
        if (typeof txt !== 'string') txt = JSON.stringify(txt);
        var t = $('#shTaRehab'); if (t) t.value = plainText(txt);
        refreshMdPv();
        toast('AI 已生成康复方案，请核对后保存');
        restore('AI 生成方案');
      }).catch(function (err) {
        toast((err && err.data && err.data.error) || 'AI 生成失败，请检查网络');
        restore('AI 生成方案');
      });
    }
  }
  function handleCaseAct(act) {
    if (!OPEN_CASE) return;
    var no = OPEN_CASE.case_no;
    if (act === 'ai-review' || act === 'tech-ai' || act === 'rehab-ai') { caseAiFill(act); return; }
    if (act === 'confirm') {
      var cond = ($('#shTaCond') || {}).value || '';
      var adv = ($('#shTaAdvice') || {}).value || '';
      if (!cond.trim() || !adv.trim()) { toast('请先填写病情情况与治疗建议'); return; }
      api('POST', '/api/cases/' + encodeURIComponent(no) + '/review', { action: 'confirm', condition: cond.trim(), advice: adv.trim() }, 12000)
        .then(function (res) {
          if ((res.data || {}).ok) { toast('已签发，患者端同步完成'); closeModal(); renderStaffRemote(); }
          else toast((res.data || {}).error || '签发失败');
        }).catch(function (err) { toast((err && err.data && err.data.error) || '签发失败，请检查网络'); });
      return;
    }
    if (act === 'reject') {
      var reason = (($('#shTaAdvice') || {}).value || '').trim() || (($('#shTaCond') || {}).value || '').trim();
      if (!reason) { toast('请在治疗建议框填写驳回原因'); return; }
      api('POST', '/api/cases/' + encodeURIComponent(no) + '/review', { action: 'reject', note: reason }, 12000)
        .then(function (res) {
          if ((res.data || {}).ok) { toast('已驳回，技师会收到修改通知'); closeModal(); renderStaffRemote(); }
          else toast((res.data || {}).error || '驳回失败');
        }).catch(function (err) { toast((err && err.data && err.data.error) || '驳回失败，请检查网络'); });
      return;
    }
    if (act === 'tech-submit') {
      var content = (($('#shTaTech') || {}).value || '').trim();
      if (!content) { toast('请先填写检查报告'); return; }
      api('POST', '/api/cases/' + encodeURIComponent(no) + '/tech-report', { content: content, submit: true }, 12000)
        .then(function (res) {
          if ((res.data || {}).ok) { toast('报告已提交，等待医师复核'); closeModal(); renderStaffRemote(); }
          else toast((res.data || {}).error || '提交失败');
        }).catch(function (err) { toast((err && err.data && err.data.error) || '提交失败，请检查网络'); });
      return;
    }
    if (act === 'rehab-save') {
      var plan = (($('#shTaRehab') || {}).value || '').trim();
      if (!plan) { toast('请先填写康复建议'); return; }
      api('POST', '/api/cases/' + encodeURIComponent(no) + '/rehab-advice', { content: plan }, 12000)
        .then(function (res) {
          if ((res.data || {}).ok) { toast('康复方案已保存并同步'); closeModal(); renderStaffRemote(); }
          else toast((res.data || {}).error || '保存失败');
        }).catch(function (err) { toast((err && err.data && err.data.error) || '保存失败，请检查网络'); });
    }
  }
  /* 报告编辑时实时刷新排版预览，避免用户对着 * 号写字 */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.tagName === 'TEXTAREA' && PV_MAP[e.target.id]) refreshMdPv();
  });
  /* 队列筛选 + 病例点击 + 弹窗操作：统一委托，避免重复绑定 */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.sh-t');
    if (t && t.parentNode && t.parentNode.id === 'shFilter') {
      STAFF_FILTER = t.getAttribute('data-f') || 'todo';
      $$('.sh-t', t.parentNode).forEach(function (x) { x.classList.toggle('on', x === t); });
      renderStaffQueue();
      return;
    }
    var row = e.target.closest('.sh-case');
    if (row) { openCaseModal(row.getAttribute('data-case')); return; }
    /* 角色工作区 / 快捷操作按钮 */
    var za = e.target.closest('[data-zact]');
    if (za) { staffAct(za.getAttribute('data-zact')); return; }
    var sa = e.target.closest('[data-sact]');
    if (sa) { staffAct(sa.getAttribute('data-sact')); return; }
    /* 新增病例：入口 / 部位与影像类型选择 / 选图 / 取消 / 提交 */
    if (e.target.closest('#shAddCase')) { openAddCase(); return; }
    if (e.target.closest('#acPick')) { var fi = $('#acFile'); if (fi) fi.click(); return; }
    if (e.target.closest('#acCancel')) { closeModal(); return; }
    if (e.target.closest('#acSubmit')) { acSubmitCase(); return; }
    var ap = e.target.closest('[data-ap]');
    if (ap && ap.parentNode && ap.parentNode.id === 'acPartChips') {
      AC.part = ap.getAttribute('data-ap') || '';
      $$('.ac-chip', ap.parentNode).forEach(function (x) { x.classList.toggle('on', x === ap); });
      var other = $('#acPartOther');
      if (other) {
        other.style.display = (AC.part === '__other__') ? '' : 'none';
        if (AC.part === '__other__') other.focus();
      }
      return;
    }
    var am = e.target.closest('[data-am]');
    if (am && am.parentNode && am.parentNode.id === 'acModChips') {
      AC.modality = am.getAttribute('data-am') || 'X光';
      $$('.ac-chip', am.parentNode).forEach(function (x) { x.classList.toggle('on', x === am); });
      return;
    }
    var act = e.target.closest('[data-cact]');
    if (act) { handleCaseAct(act.getAttribute('data-cact')); }
  });

  function renderStaffRemote() {
    renderStaffChrome();
    if (!SYNC_ON || serverReachable === false) {
      /* 离线：队列只显示本机建档的病例，KPI 由本地数据算出，不再留一排 0 让人以为坏了 */
      paintLive('off');
      STAFF_CASES = loadLocalCases();
      STAFF_SUM = { draft: localDraftCount(), analyzed_today: localDraftCount() };
      renderStaffQueue();
      paintStaffOfflineKpi();
      paintStaffTiles();
      openPendingCase();
      return;
    }
    api('GET', '/api/summary', null, 7000).then(function (res) {
      var s = (res.data || {}).summary || {};
      STAFF_SUM = s;
      paintStaffTiles();
      /* 三格 KPI 按角色语义取值，避免技师看到「待复核」这类与自己无关的数字 */
      var k1, k2;
      if (currentRole === 'technician') {
        k1 = s.draft; k2 = s.pending;
      } else if (currentRole === 'therapist') {
        k1 = Math.max(0, (s.confirmed || 0) - (s.in_rehab || 0)); k2 = s.in_rehab;
      } else {
        k1 = s.pending; k2 = s.draft;
      }
      setNum('#shKpiPending', k1);
      setNum('#shKpiDraft', k2);
      setNum('#shKpiDone', s.confirmed);
      bumpLocalKpi();
      var fc = $('#shFollowCard'), fb = $('#shFollowBox');
      var due = s.followups_due || 0, soon = s.followups_soon || 0;
      var followMine = (currentRole !== 'technician');   /* 随访归治疗师/医师管，技师不看这块 */
      if (fc && fb) {
        if (followMine && (due || soon)) {
          fc.style.display = '';
          fb.innerHTML =
            (due ? '<div class="cell"><span class="ci red"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg></span><div class="ct"><b>' + due + ' 例已到随访周期</b><p>建议本周安排复查与 ROM 复评</p></div></div>' : '') +
            (soon ? '<div class="cell"><span class="ci amber"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div class="ct"><b>' + soon + ' 例 7 日内到期</b><p>可提前与患者预约复查时间</p></div></div>' : '');
        } else { fc.style.display = 'none'; }
      }
      paintLive('ok');
    }).catch(function () { paintLive('off'); });

    api('GET', '/api/cases', null, 8000).then(function (res) {
      var d = res.data || {};
      if (!d.ok) { renderStaffQueue(); return; }
      STAFF_CASES = loadLocalCases().concat(d.cases || []);
      renderStaffQueue();
      /* 新建档后自动打开该病例，方便立刻补报告或核对 AI 初判 */
      openPendingCase();
    }).catch(function () { renderStaffQueue(); });
  }
  /* 患者档案（远程）：拉取本人病例，回填首页恢复度/病例号，AI 上下文用真实病例号 */
  function renderPatientRemote() {
    if (!SYNC_ON || !AUTH_TOKEN || serverReachable === false) return;
    api('GET', '/api/cases', null, 7000).then(function (res) {
      var d = res.data || {};
      if (!d.ok) return;
      var cases = d.cases || [];
      if (!cases.length) return;
      var c0 = cases[0];
      CUR_CASE = c0;   // 用于 AI 上下文 case_no
      // 用真实病例回填首页关键展示
      var cnEl = $('#caseNoText'), partEl = $('#casePart');
      if (cnEl) cnEl.textContent = '病例号 ' + (c0.case_no || '');
      if (partEl) partEl.textContent = (c0.part || '') + ' · ' + (c0.finding_label || c0.stage || '康复中');
      // 恢复度：拉 recovery 接口（有随访才有分数）
      if (c0.case_no) {
        api('GET', '/api/cases/' + encodeURIComponent(c0.case_no) + '/recovery', null, 10000).then(function (r2) {
          var dd = r2.data || {};
          if (dd.ok && typeof dd.score === 'number' && dd.followups > 0) {
            ST.score = dd.score; saveState(); renderAllStats();
          }
        }).catch(function () {});
      }
    }).catch(function () {});
  }
  /* 患者康复状态同步：新版后端用「随访记录」承载，打卡/自评写入 followups（静默，失败不影响本地演示） */
  function syncStateRemote() {
    if (!SYNC_ON || !AUTH_TOKEN) return;
    var cn = curCaseNo(); if (!cn) return;
    api('POST', '/api/cases/' + encodeURIComponent(cn) + '/followups', {
      record_date: ymd(TODAY), pain_score: 0, rom: Math.min(100, ST.score || 0),
      swelling: '无', training: '当日康复训练打卡', note: '患者端自动记录'
    }, 8000).catch(function () {});
  }
  /* 疼痛自评（含预警判定）写入随访记录；pain≥7 由后端/前端判定预警 */
  function syncCheckinRemote(pain, day) {
    if (!SYNC_ON || !AUTH_TOKEN) return;
    var cn = curCaseNo(); if (!cn) return;
    api('POST', '/api/cases/' + encodeURIComponent(cn) + '/followups', {
      record_date: day, pain_score: pain, rom: 0,
      swelling: pain >= 7 ? '中' : '无', training: pain >= 7 ? '疼痛预警，暂停训练' : '常规训练',
      note: pain >= 7 ? '疼痛评分偏高，建议联系治疗师' : '患者自评'
    }, 8000).catch(function () {});
  }
  /* 患者留言：新版后端以随访/AI 留痕承载，无独立留言接口；这里降级为 toast 提示 */
  function syncMessageRemote(content, toRole) {
    /* 新版后端未提供独立留言接口，改为写入随访备注（若有病例） */
    if (!SYNC_ON || !AUTH_TOKEN) return;
    var cn = curCaseNo(); if (!cn) return;
    api('POST', '/api/cases/' + encodeURIComponent(cn) + '/followups', {
      record_date: ymd(TODAY), pain_score: 0, rom: 0,
      swelling: '无', training: '', note: '留言：' + content
    }, 8000).catch(function () {});
  }
  /* 全局点击委托里处理远程管理操作（data-ra）：注册申请通过/驳回 */
  document.addEventListener('click', function (e) {
    var ra = e.target.closest('[data-ra]');
    if (!ra) return;
    var action = ra.dataset.ra, id = ra.dataset.id;
    if (!SYNC_ON) return;
    if (action !== 'approve' && action !== 'reject') return;
    api('POST', '/api/admin/pending/' + id + '/' + action, null, 8000).then(function (res) {
      var d = res.data || {};
      if (d.ok) {
        toast(action === 'approve' ? '已通过注册申请' : '已驳回申请');
        renderAdminRemote();
      } else {
        toast(d.error || '操作失败');
      }
    }).catch(function () { toast('操作失败，请检查服务连接'); });
  });

  /* ---------- 消息已读：列表红点与首页铃铛必须同步，已读状态持久化到 localStorage ---------- */
  var READ_KEY = 'lsy_msg_read';
  function getRead() { try { return JSON.parse(localStorage.getItem(READ_KEY) || '[]'); } catch (e) { return []; } }
  function setRead(a) { try { localStorage.setItem(READ_KEY, JSON.stringify(a)); } catch (e) {} }
  /* 每条消息用 data-go 值作为唯一 id，找出当前带红点的消息 id 列表 */
  function unreadIds() {
    var ids = [];
    $$('.msg-item').forEach(function (mi) {
      var u = mi.querySelector('.unread');
      if (u && mi.getAttribute('data-go')) ids.push(mi.getAttribute('data-go'));
    });
    return ids;
  }
  /* 启动时：把已读消息的红点摘掉，再同步铃铛 */
  function applyReadState() {
    var read = getRead();
    $$('.msg-item').forEach(function (mi) {
      if (read.indexOf(mi.getAttribute('data-go')) !== -1) {
        var u = mi.querySelector('.unread');
        if (u) u.remove();
      }
    });
    syncUnread();
  }
  function syncUnread() {
    var n = $$('.unread').length;
    var dot = $('.bell .dot');
    if (dot) { dot.textContent = n; dot.style.display = n ? 'flex' : 'none'; }
  }
  function markOneRead(id) {
    if (!id) return;
    var read = getRead();
    if (read.indexOf(id) === -1) { read.push(id); setRead(read); }
  }
  $('#markRead').addEventListener('click', function () {
    var n = $$('.unread').length;
    if (!n) { toast('暂无未读消息'); return; }
    /* 把当前所有带红点的消息都记入已读 */
    var read = getRead();
    unreadIds().forEach(function (id) { if (read.indexOf(id) === -1) read.push(id); });
    setRead(read);
    $$('.unread').forEach(function (u) { u.remove(); });
    syncUnread();
    toast('已将 ' + n + ' 条消息标为已读');
  });
  applyReadState();

  /* ---------- 复诊提醒：唤起系统日历新建事件 ---------- */
  function openReminder() {
    if (!window.plus || !plus.android) {
      toast('请在手机 App 内打开，可直接写入系统日历');
      return;
    }
    try {
      var main = plus.android.runtimeMainActivity();
      var Intent = plus.android.importClass('android.content.Intent');
      var Uri = plus.android.importClass('android.net.Uri');
      var intent = new Intent('android.intent.action.INSERT');
      intent.setData(Uri.parse('content://com.android.calendar/events'));
      intent.putExtra('title', '复查 X 线 · 左腕（灵视医影）');
      intent.putExtra('description', '左腕骨折愈合复查，请携带既往影像');
      intent.putExtra('eventLocation', 'XX学院合作医院 · 运动创伤/康复科');
      // 注：5+ 反射 putExtra 超大毫秒数(long)存在兼容问题，这里不预填时间，
      // 打开系统日历新建页后由用户选择 2026-10-08 09:00 再保存。
      intent.putExtra('allDay', false);
      main.startActivity(intent);
      toast('已打开日历，请选择 10-08（周四）09:00 后保存');
    } catch (e) {
      var msg = (e && (e.message || e.description)) ? (e.message || e.description) : String(e);
      toast('日历唤起失败：' + String(msg).slice(0, 60));
    }
  }
  $$('.remind-trigger').forEach(function (b) { b.addEventListener('click', openReminder); });

  /* ---------- 影像查看器：期次 / 标注层 ---------- */
  var CUR_PHASE = true;           // true=初诊 false=复查
  var DETECTED = null;            // 最近一次 AI 识别结果
  function setPhase(initial) {
    CUR_PHASE = initial;
    DETECTED = null;
    $('#viewerImg').src = initial ? 'assets/xray-initial.webp' : 'assets/xray-followup.webp';
    $('#viewerDate').textContent = initial ? '拍摄日期 2026-09-10' : '拍摄日期 2026-09-24';
    var frame = $('#aiFrame'), tag = $('#aiTag');
    frame.style.display = '';
    $('#toggleFrame').classList.add('on');
    if (initial) {
      frame.style.borderColor = '#3b82f6';
      frame.style.boxShadow = '0 0 0 1px rgba(59,130,246,.4),0 0 16px rgba(59,130,246,.3)';
      tag.textContent = '桡骨远端疑似骨折 · 0.83';
      tag.style.background = 'rgba(37,99,235,.94)';
    } else {
      frame.style.borderColor = '#2dd4bf';
      frame.style.boxShadow = '0 0 0 1px rgba(45,212,191,.4),0 0 16px rgba(45,212,191,.3)';
      tag.textContent = '骨痂形成 · 骨折线模糊';
      tag.style.background = 'rgba(13,148,136,.94)';
    }
    $('#tabInitial').classList.toggle('on', initial);
    $('#tabFollow').classList.toggle('on', !initial);
    var ds = $('#detectStatus');
    if (ds) ds.style.display = 'none';
  }
  /* 把当前影像转成 base64（canvas 读取，file:// 下同样可用）
     优先用 canvas（浏览器/同源本地资源）；canvas 被污染或失败时，
     App 内用 plus.net 原生 XHR 直接读本地文件（本地资源不存在跨域污染）。 */
  function viewerImageBase64(cb) {
    var img = $('#viewerImg');
    function viaCanvas() {
      try {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth || 640;
        c.height = img.naturalHeight || 640;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var dataUrl = c.toDataURL('image/jpeg', 0.85);
        var b64 = dataUrl.split(',')[1] || '';
        if (b64) { cb(b64); return true; }
      } catch (e) {}
      return false;
    }
    function viaPlus() {
      try {
        var src = img.getAttribute('src') || img.src;
        // 相对路径拼成 file:// 绝对路径
        if (src.indexOf('file://') !== 0) {
          var loc = location.href;
          var base = loc.substring(0, loc.lastIndexOf('/') + 1);
          src = base + src;
        }
        var xhr = new plus.net.XMLHttpRequest();
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
          try {
            var bytes = new Uint8Array(xhr.response);
            var bin = '';
            for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            cb(btoa(bin));
          } catch (e) { cb(''); }
        };
        xhr.onerror = function () { cb(''); };
        xhr.open('GET', src);
        xhr.send();
        return true;
      } catch (e) { return false; }
    }
    if (!viaCanvas() && !viaPlus()) cb('');
  }
  /* 用识别结果重新定位标注框（box 为原图像素坐标，需映射到 object-fit:contain 的显示区） */
  function applyDetection(det) {
    var frame = $('#aiFrame'), tag = $('#aiTag');
    var stageEl = $('#viewerStage');
    var img = $('#viewerImg');
    if (!frame || !tag || !stageEl) return;
    var sw = stageEl.clientWidth, sh = stageEl.clientHeight;
    var iw = img.naturalWidth || 640, ih = img.naturalHeight || 640;
    var scale = Math.min(sw / iw, sh / ih);
    var dw = iw * scale, dh = ih * scale;
    var ox = (sw - dw) / 2, oy = (sh - dh) / 2;
    var b = det.box;
    var left = ox + b[0] * scale, top = oy + b[1] * scale;
    var width = (b[2] - b[0]) * scale, height = (b[3] - b[1]) * scale;
    frame.style.left = left + 'px';
    frame.style.top = top + 'px';
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    frame.style.display = '';
    $('#toggleFrame').classList.add('on');
    var isFr = det.label === 'fracture';
    frame.style.borderColor = isFr ? '#ef4444' : '#2dd4bf';
    frame.style.boxShadow = isFr
      ? '0 0 0 1px rgba(239,68,68,.5),0 0 18px rgba(239,68,68,.35)'
      : '0 0 0 1px rgba(45,212,191,.5),0 0 18px rgba(45,212,191,.35)';
    var labelTxt = isFr ? '疑似骨折' : '未见骨折';
    tag.textContent = labelTxt + ' · ' + Math.round(det.conf * 100) + '%';
    tag.style.background = isFr ? 'rgba(220,38,38,.95)' : 'rgba(13,148,136,.95)';
  }
  /* 触发 AI 影像识别（上传到后端 YOLO 推理，返回框叠加到图上） */
  function runDetect() {
    var ds = $('#detectStatus');
    if (!SYNC_ON) { toast('影像识别需开启数据同步（SYNC_ENABLED）'); return; }
    if (ds) { ds.style.display = ''; ds.textContent = '识别中…'; }
    viewerImageBase64(function (b64) {
      if (!b64) { if (ds) ds.textContent = '读取影像失败'; toast('读取影像失败'); return; }
      api('POST', '/api/ai/detect', { image_b64: b64, conf: (CFG.DETECT_CONF != null ? CFG.DETECT_CONF : 0.15) }, 20000).then(function (res) {
        var d = res.data || {};
        var dets = d.detections || [];
        // 新版后端返回归一化 bbox（0~1）+ 原图尺寸，这里转成像素坐标喂给 applyDetection
        var iw = (d.image && d.image.width) || 640;
        var ih = (d.image && d.image.height) || 640;
        function toPx(bbox) {
          return [bbox[0] * iw, bbox[1] * ih, bbox[2] * iw, bbox[3] * ih];
        }
        if (d.ok && dets.length && dets[0].bbox) {
          DETECTED = { label: dets[0].label, conf: dets[0].conf, box: toPx(dets[0].bbox) };
          applyDetection(DETECTED);
          if (ds) { ds.textContent = '已识别 · ' + (dets[0].label === 'fracture' ? '疑似骨折' : '未见骨折') + ' ' + Math.round(dets[0].conf * 100) + '%'; }
        } else if (d.ok) {
          // 无骨折框（normal 或空）：隐藏标注框，显示「未见骨折」
          DETECTED = null;
          var frame = $('#aiFrame'); if (frame) frame.style.display = 'none';
          var lbl = (dets[0] && dets[0].label_zh) || '未见明显骨折';
          if (ds) ds.textContent = '已识别 · ' + lbl;
        } else {
          if (ds) ds.textContent = d.mode === 'no-model' ? '未部署模型' : '识别失败';
          toast(d.error || '识别失败');
        }
      }).catch(function () {
        if (ds) ds.textContent = '服务不可达';
        toast('识别服务暂时不可达');
      });
    });
  }
  $('#detectBtn').addEventListener('click', runDetect);
  $('#tabInitial').addEventListener('click', function () { setPhase(true); });
  $('#tabFollow').addEventListener('click', function () { setPhase(false); });
  $('#toggleFrame').addEventListener('click', function () {
    var on = this.classList.toggle('on');
    $('#aiFrame').style.display = on ? '' : 'none';
  });

  /* ---------- 前后对比滑块（指针 / 触摸） ---------- */
  var stage = $('#compareStage'), dragging = false;
  function setCmp(clientX) {
    var r = stage.getBoundingClientRect();
    var p = ((clientX - r.left) / r.width) * 100;
    p = Math.max(0, Math.min(100, p));
    $('#cmpTop').style.clipPath = 'inset(0 ' + (100 - p) + '% 0 0)';
    $('#cmpHandle').style.left = p + '%';
  }
  stage.addEventListener('pointerdown', function (e) { dragging = true; try { stage.setPointerCapture(e.pointerId); } catch (err) {} setCmp(e.clientX); });
  stage.addEventListener('pointermove', function (e) { if (dragging) setCmp(e.clientX); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { stage.addEventListener(ev, function () { dragging = false; }); });

  /* ---------- 影像缩放：双击放大 / 双指缩放 / 放大后单指拖动 ---------- */
  var ZS = { s: 1, tx: 0, ty: 0 };
  var zPts = {}, zStart = null, zDist0 = 0, zS0 = 1, zMulti = false, zMoved = false, zLastTap = 0;
  function zApply() {
    var inner = $('#vsInner');
    if (!inner) return;
    inner.style.transform = 'translate(' + ZS.tx + 'px,' + ZS.ty + 'px) scale(' + ZS.s + ')';
    var vs = $('#viewerStage');
    if (vs) vs.style.touchAction = ZS.s > 1.01 ? 'none' : '';
    var badge = $('#zoomLevel');
    if (badge) {
      badge.textContent = Math.round(ZS.s * 100) + '%';
      badge.classList.toggle('show', ZS.s > 1.01);
    }
    var btn = $('#zoomBtn');
    if (btn) btn.classList.toggle('on', ZS.s > 1.01);
  }
  function zSet(s, tx, ty) {
    ZS.s = Math.max(1, Math.min(4, s));
    ZS.tx = tx || 0; ZS.ty = ty || 0;
    if (ZS.s <= 1.01) { ZS.s = 1; ZS.tx = 0; ZS.ty = 0; }
    var vs = $('#viewerStage');
    if (vs) {
      var mx = (ZS.s - 1) * vs.clientWidth / 2, my = (ZS.s - 1) * vs.clientHeight / 2;
      ZS.tx = Math.max(-mx, Math.min(mx, ZS.tx));
      ZS.ty = Math.max(-my, Math.min(my, ZS.ty));
    }
    zApply();
  }
  var vstage = $('#viewerStage');
  if (vstage) {
    vstage.addEventListener('pointerdown', function (e) {
      zPts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(zPts);
      if (ids.length >= 2) { zMulti = true; }
      if (ids.length === 1) zStart = { x: e.clientX, y: e.clientY, tx: ZS.tx, ty: ZS.ty };
      if (ids.length === 2) {
        var a = zPts[ids[0]], b = zPts[ids[1]];
        zDist0 = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) || 1;
        zS0 = ZS.s;
      }
      try { vstage.setPointerCapture(e.pointerId); } catch (err) {}
    });
    vstage.addEventListener('pointermove', function (e) {
      if (!zPts[e.pointerId]) return;
      zPts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(zPts);
      if (ids.length >= 2) {
        var a = zPts[ids[0]], b = zPts[ids[1]];
        var d = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) || 1;
        zSet(zS0 * d / zDist0, ZS.tx, ZS.ty);
      } else if (ZS.s > 1.01 && zStart) {
        if (Math.abs(e.clientX - zStart.x) + Math.abs(e.clientY - zStart.y) > 8) zMoved = true;
        zSet(ZS.s, zStart.tx + (e.clientX - zStart.x), zStart.ty + (e.clientY - zStart.y));
      }
    });
    function zEnd(e) {
      var wasSingle = Object.keys(zPts).length === 1;
      delete zPts[e.pointerId];
      var ids = Object.keys(zPts);
      if (!ids.length) {
        /* 单指双击：放大 / 还原（自行判定，比 dblclick 在 WebView 里可靠） */
        if (e.type === 'pointerup' && wasSingle && !zMulti && !zMoved) {
          var now = Date.now();
          if (now - zLastTap < 320) {
            var r = vstage.getBoundingClientRect();
            var cx = e.clientX - r.left - r.width / 2;
            var cy = e.clientY - r.top - r.height / 2;
            if (ZS.s > 1.01) zSet(1, 0, 0);
            else zSet(2.4, -cx * 1.4, -cy * 1.4);
            zLastTap = 0;
          } else {
            zLastTap = now;
          }
        }
        zStart = null;
        zMulti = false;
        zMoved = false;
      } else {
        var p = zPts[ids[0]];
        zStart = { x: p.x, y: p.y, tx: ZS.tx, ty: ZS.ty };
      }
    }
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { vstage.addEventListener(ev, zEnd); });
  }
  var zoomBtn = $('#zoomBtn');
  if (zoomBtn) zoomBtn.addEventListener('click', function () {
    if (ZS.s > 1.01) zSet(1, 0, 0);
    else zSet(2.4, 0, 0);
  });

  /* ---------- 今日训练流程（进度落盘，首页 / 周计划 / 训练页三处联动） ---------- */
  var EX = [
    { n: '腕关节主动屈伸', s: '3 组 × 15 次' },
    { n: '握力球训练', s: '3 组 × 15 次' },
    { n: '手指屈伸训练', s: '3 组 × 20 次' }
  ];
  var ST_KEY = 'lsy_state';
  var ST = (function () {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(ST_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    if (typeof s.done !== 'number') s.done = 0;
    if (typeof s.streak !== 'number') s.streak = 12;
    if (typeof s.score !== 'number') s.score = 78;
    if (typeof s.min !== 'number') s.min = 156;
    if (!s.day) s.day = '';
    if (!s.doneDay) s.doneDay = '';   /* 已打卡标记日：用于跨天自动清零，避免首日进入就 +1 */
    return s;
  })();
  function saveState() { try { localStorage.setItem(ST_KEY, JSON.stringify(ST)); } catch (e) {} }
  function doneToday() { return ST && typeof ST.done === 'number' ? ST.done : 0; }
  function scoreToday() { return ST && typeof ST.score === 'number' ? ST.score : 78; }
  /* 跨天自动清零（否则第二天打开还显示昨天的进度）。
     关键：只有「前一天真的打过卡」才让连续天数 +1，首次进入不虚增 */
  (function ensureDay() {
    var today = ymd(TODAY);
    if (ST.day !== today) {
      ST.day = today;
      if (ST.doneDay === ymd(dayAdd(TODAY, -1))) { ST.streak += 1; }
      ST.done = 0;
      saveState();
    }
  })();

  var ti = 0;
  var CHECK_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';

  /* 同步首页卡片与本周计划里的「n/3」 */
  function renderProgress() {
    var n = doneToday();
    var t = $('#homeDone'), b = $('#homeProg');
    if (t) t.textContent = n + '/3';
    if (b) b.style.width = Math.round(n / 3 * 100) + '%';
    var tn = $('.day.today .dc');
    if (tn) tn.textContent = n + '/3';
  }

  /* 同步恢复度 / 连续打卡 / 累计分钟等全站统计口径（首页环形、我的页、曲线、AI 回复） */
  function renderAllStats() {
    var sc = scoreToday();
    var ring = $('#homeRing'), hs = $('#homeScore');
    if (hs) hs.textContent = sc;
    if (ring) {
      var C = 2 * Math.PI * 38;               /* 圆周长 238.76 */
      ring.setAttribute('stroke-dasharray', (C * sc / 100).toFixed(1) + ' ' + C.toFixed(1));
    }
    var ms = $('#meScore'), mk = $('#meStreak');
    if (ms) ms.textContent = sc;
    if (mk) mk.textContent = ST.streak;
    renderCurve();
  }
  function resetToday() { ti = Math.min(doneToday(), 2); renderToday(); }
  function renderToday() {
    var n = doneToday();
    var finished = n >= 3;
    ti = Math.min(n, 2);
    var x = EX[ti];
    $('#exIndex').textContent = finished ? 3 : ti + 1;
    $('#exName').textContent = x.n;
    $('#exSets').textContent = x.s;
    $$('#dots i').forEach(function (d, i) { d.className = i < n ? 'done' : (i === n ? 'on' : ''); });
    for (var i = 0; i < 3; i++) {
      var st = $('#st' + i), tag = $('#tag' + i);
      if (!st || !tag) continue;
      if (i < n) { st.className = 'ci teal'; st.innerHTML = CHECK_SVG; tag.textContent = '已完成'; tag.style.color = 'var(--teal-d)'; tag.style.fontWeight = '600'; }
      else if (i === n) { st.className = 'ci blue'; st.innerHTML = '<b style="font-size:14px;">' + (i + 1) + '</b>'; tag.textContent = '进行中'; tag.style.color = 'var(--blue)'; tag.style.fontWeight = '600'; }
      else { st.className = 'ci gray'; st.innerHTML = '<b style="font-size:14px;">' + (i + 1) + '</b>'; tag.textContent = '待完成'; tag.style.color = 'var(--mut)'; tag.style.fontWeight = '400'; }
    }
    $('#nextEx').textContent = finished ? '查看今日自评' : (n >= 2 ? '完成训练，去自评' : '完成本动作，下一个');
    renderProgress();
  }
  $('#nextEx').addEventListener('click', function () {
    if (doneToday() >= 3) { go('done'); return; }
    ST.done = Math.min(3, doneToday() + 1);
    saveState(); renderToday();
    if (ST.done >= 3) { toast('3 个动作全部完成，去自评'); go('selfcheck'); }
    else toast('已完成，进入下一动作');
  });
  $('#markEx').addEventListener('click', function () {
    if (doneToday() < 3) { ST.done = doneToday() + 1; saveState(); }
    renderToday();
    toast('已标记「握力球训练」完成');
    if (stack[stack.length - 1] !== 'today') stack.push('today');
    show('today');
  });
  $('#pauseBtn').addEventListener('click', function () { toast('训练已暂停，休息一下吧'); });
  $('#editProfile').addEventListener('click', function () { toast('演示环境已保存'); });

  /* 打卡结果页：正常完成 / 疼痛预警，两套文案，避免「评分 8 分却说训练已完成」 */
  function showDone(kind) {
    var warn = kind === 'warn';
    var n = doneToday();
    var t = $('#doneTitle'), s = $('#doneSub'), ex = $('#doneExtra');
    if (t) t.textContent = warn ? '已提交疼痛预警' : '今日训练已完成';
    if (s) s.textContent = warn ? '治疗师已收到提醒，请暂停训练并等待联系' : '坚持就是重返球场最快的路';
    var st = $('#doneStreak'), rt = $('#doneRate'), mi = $('#doneMin');
    if (st) st.textContent = warn ? '暂停' : ST.streak;
    if (rt) rt.textContent = warn ? '—' : (n >= 3 ? '100%' : Math.round(n / 3 * 100) + '%');
    if (mi) mi.textContent = warn ? '0' : String(ST.min);
    if (ex) {
      ex.innerHTML = warn
        ? '本次记录已标记预警，综合恢复度暂不增加，请以治疗师意见为准'
        : '本次打卡后综合恢复度 ' + scoreToday() + ' 分' + (n >= 3 ? '（<b>+1</b>）' : '');
    }
    go('done');
    toast(warn ? '已提交并标记预警，已通知治疗师' : '打卡已提交，恢复度 +1');
  }

  /* ---------- 训练后自评 ---------- */
  function vColor(v) { return v >= 7 ? '#ef4444' : (v >= 4 ? '#f59e0b' : '#0ea5a0'); }
  function bindScale(id, valId) {
    var input = $('#' + id), val = $('#' + valId);
    input.addEventListener('input', function () {
      val.textContent = input.value;
      if (id !== 'mob') val.style.color = vColor(+input.value);
    });
  }
  bindScale('vas', 'vasVal');
  bindScale('swell', 'swellVal');
  bindScale('mob', 'mobVal');
  $('#submitCheck').addEventListener('click', function () {
    var v = +$('#vas').value;
    if (v >= 7) {
      openModal(
        '<div class="m-ico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></div>' +
        '<h4 style="color:#b91c1c;">疼痛评分偏高</h4><p>您本次疼痛评分为 ' + v + ' 分，建议暂停训练并尽快联系康复治疗师。本次打卡仍会提交并标记预警。</p>' +
        '<div class="m-btns"><button class="btn m-cancel" data-act="cancel">返回修改</button><button class="btn m-danger" data-act="warnSubmit">提交并联系医生</button></div>'
      );
    } else {
      /* 正常完成：恢复度 +1、连续天数 +1、累计分钟累加，三处数据真正联动落盘 */
      if (ST.doneDay !== ymd(TODAY)) {
        ST.doneDay = ymd(TODAY);
        ST.streak += 1;
        ST.score = Math.min(90, ST.score + 1);
      }
      ST.min += 12 * doneToday();
      saveState();
      renderAllStats();
      showDone('ok');
      /* 同步到服务器：恢复度/连续天数/累计分钟，医护端可看到最新进度 */
      syncStateRemote();
      syncCheckinRemote(parseInt($('#vas').value, 10), ymd(TODAY));
    }
  });

  /* ---------- 恢复度曲线（自绘 SVG，替掉 1MB 的 echarts） ---------- */
  function curveData() {
    return [
      { d: C.injure, v: 42 },
      { d: dayAdd(C.injure, 7), v: 58 },
      { d: C.follow, v: 72 },
      { d: TODAY, v: scoreToday() }
    ];
  }
  function renderCurve() {
    var el = $('#chartRecovery');
    if (!el) return;
    var pts = curveData();
    var W = 330, H = 200, L = 30, R = 12, T = 26, B = 174, n = pts.length;
    var x = function (i) { return L + (W - L - R) * i / (n - 1); };
    var y = function (v) { return B - (B - T) * v / 100; };
    var grid = '';
    [0, 25, 50, 75, 100].forEach(function (v) {
      grid += '<line x1="' + L + '" y1="' + y(v) + '" x2="' + (W - R) + '" y2="' + y(v) + '" stroke="#eef2f7" stroke-width="1"/>' +
              '<text x="' + (L - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" font-size="10" fill="#94a3b8">' + v + '</text>';
    });
    var line = 'M' + x(0) + ' ' + y(pts[0].v);
    for (var i = 1; i < n; i++) {
      var x0 = x(i - 1), y0 = y(pts[i - 1].v), x1 = x(i), y1 = y(pts[i].v), k = (x1 - x0) / 2.6;
      line += ' C' + (x0 + k) + ' ' + y0 + ' ' + (x1 - k) + ' ' + y1 + ' ' + x1 + ' ' + y1;
    }
    var dots = '', labels = '', xl = '';
    pts.forEach(function (p, i) {
      var anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      dots += '<circle cx="' + x(i) + '" cy="' + y(p.v) + '" r="4.2" fill="#2563eb" stroke="#fff" stroke-width="2"/>';
      labels += '<text x="' + x(i) + '" y="' + (y(p.v) - 11) + '" text-anchor="' + anchor + '" font-size="11" font-weight="700" fill="#1d4ed8">' + p.v + '</text>';
      xl += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === n - 1 ? 'end' : 'middle') + '" font-size="10" fill="#64748b">' + md(p.d) + '</text>';
    });
    el.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="综合恢复度曲线">' +
      '<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#2563eb" stop-opacity=".22"/><stop offset="100%" stop-color="#2563eb" stop-opacity=".02"/>' +
      '</linearGradient></defs>' +
      grid +
      '<line x1="' + L + '" y1="' + y(90) + '" x2="' + (W - R) + '" y2="' + y(90) + '" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<text x="' + (W - R) + '" y="' + (y(90) - 5) + '" text-anchor="end" font-size="10" fill="#ef4444">可回归训练 90</text>' +
      '<path d="' + line + ' L' + x(n - 1) + ' ' + B + ' L' + x(0) + ' ' + B + ' Z" fill="url(#cg)"/>' +
      '<path d="' + line + '" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      dots + labels + xl +
      '<line x1="' + L + '" y1="' + B + '" x2="' + (W - R) + '" y2="' + B + '" stroke="#cbd5e1"/>' +
      '</svg>';
  }

  /* ---------- AI 康复助手（真实后端优先，不可达则回落本地模板） ---------- */
  var VISIT_TXT = ymd(C.next) + '（' + wd(C.next) + '）09:00';
  function aiReplies() {
    var sc = scoreToday();
    return {
      interpret:
        '当前病例 <b>' + CASE_NO + '</b>：左腕桡骨远端骨折（闭合性，康复中）。' +
        md(C.injure) + ' 初诊，' + md(C.follow) + ' 复查示骨折线模糊、骨痂形成，损伤区域面积较初诊缩小约 31%。' +
        '综合恢复度 <b>' + sc + ' 分</b>（目标 90 分），当前处于第 ' + STAGE_WEEK + ' 周 · 活动恢复期，计划 ' + VISIT_TXT + ' 复查 X 线。' +
        '<br>以上为 AI 辅助整理，最终以执业医师签发的报告为准。',
      rehab:
        '当前阶段（活动恢复期）建议训练：<br>· 腕关节主动屈伸　3 组 × 15 次<br>· 握力球训练　　　3 组 × 15 次<br>· 手指屈伸训练　　3 组 × 20 次<br>' +
        '以无痛、不肿为度，疼痛评分 ≥ 7 时应暂停并联系治疗师。<br><b>禁忌动作：</b>患腕负重、旋转发力、撑地类动作。' +
        '<br>下一节点：' + md(C.next) + ' 复查后由医生评估是否进入力量恢复期。方案已由康复治疗师确认，具体以「康复计划」页为准。',
      time:
        '桡骨远端骨折常规愈合约 <b>6–8 周</b>。您已进入第 ' + STAGE_WEEK + ' 周活动恢复期，恢复度 ' + sc + ' / 90。' +
        '按当前进度预计还需 2–3 周力量与功能训练，经 ' + md(C.next) + ' 复查及医生评估达标后，方可逐步回归训练（先无对抗，再逐步增加强度）。' +
        '<br>是否可回归运动必须由执业医师判定，系统仅作提醒。',
      summary:
        '<b>宋同学</b> · 21 岁 · 篮球 · 校队<br>病例：' + CASE_NO + ' · 左腕桡骨远端骨折（闭合性）<br>' +
        '阶段：第 ' + STAGE_WEEK + ' 周 · 活动恢复期（' + md(C.injure) + ' 受伤）<br>恢复度：' + sc + ' / 90（目标 90）<br>' +
        '复查：' + VISIT_TXT + ' 复查 X 线<br>禁忌：患腕负重、旋转发力、撑地类动作<br>责任医师：杨同学 ｜ 治疗师：张同学'
    };
  }
  var AI_FALLBACK =
    '我目前可围绕当前康复病例回答：<b>解读当前病例、康复方案建议、恢复时间咨询、生成摘要</b>。更复杂的问题已为您记录，正式版将由大模型实时回答。<br>回复仅供辅助参考，不构成医疗诊断。';
  var aiBusy = false;

  /* 后端地址统一在 config.js 里配置，这里不再写死 127.0.0.1：
     地址为空 → 不发请求，直接给模板回复（不会卡「正在思考」）；
     地址非空 → 走真实大模型，失败/超时自动回落。 */
  var AI_BASE = String((CFG.AI_API_URL || '')).replace(/\/+$/, '');
  var AI_API_TIMEOUT = CFG.AI_API_TIMEOUT || 12000;
  var AI_QUICK_TEXT = { interpret: '解读当前病例', rehab: '康复方案建议', time: '恢复时间咨询', summary: '生成摘要' };
  var AI_DEMO_TAG = '<span class="ai-tag-demo">演示模式：未连接 AI 服务，以上为本地模板回复</span>';
  /* ---------- 请求通道 ----------------------------------------------------
     这是「App 装在本机、页面不上云，同时 AI 真能联网」的关键。

     1) App 内（HBuilderX 打包的安装包）：web-view 加载的页面同样跑在 5+ 运行时里，
        能拿到 plus.net.XMLHttpRequest。它是原生网络栈，不是浏览器 XHR，
        **不受同源策略约束**，所以 file:// 页面请求 http://公网IP 完全合法，
        CORS 这道坎直接绕过去（服务器不用配 Access-Control-Allow-Origin）。
     2) 浏览器 / H5 调试：没有 plus，走 fetch。同域部署时天然可用。
     3) 都失败：回落本地模板，并在页面顶部标明「AI 服务暂时不可达」，不假装已连接。
     ------------------------------------------------------------------------ */
  var aiFailCount = 0;      // 连续失败次数，用来熔断，避免每次提问都白等超时
  var aiChanUsed = '';      // 上一次成功使用的通道，便于诊断显示
  var CUR_CASE = null;      // 当前上下文病例号（患者登录后从 /api/cases 拉到真实病例号）
  function curCaseNo() {
    if (CUR_CASE && CUR_CASE.case_no) return CUR_CASE.case_no;
    return '';              // 空字符串：后端按「未选病例」返回引导语
  }
  var API_BASE = String((CFG.AI_API_URL || '')).replace(/\/+$/, '');
  var SYNC_ON = !!CFG.SYNC_ENABLED && !!API_BASE;
  var AUTH_TOKEN = null;    // 登录后保存的鉴权 token，随请求一起发
  var CUR_USER = null;      // 当前登录用户（新版后端返回 {username,name,role,views}）
  var AUTH_KEY = 'lsy_auth';
  /* token 持久化：退出重进 App 保持登录态（本地仅存 token 与用户名，不含明文密码） */
  function saveAuth() {
    try {
      if (AUTH_TOKEN && CUR_USER) {
        localStorage.setItem(AUTH_KEY, JSON.stringify({ token: AUTH_TOKEN, user: CUR_USER }));
      } else {
        localStorage.removeItem(AUTH_KEY);
      }
    } catch (e) {}
  }
  function loadAuth() {
    try {
      var a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (a && a.token && a.user) { AUTH_TOKEN = a.token; CUR_USER = a.user; return true; }
    } catch (e) {}
    return false;
  }
  function apiTransport() {
    try {
      if (window.plus && plus.net && plus.net.XMLHttpRequest) return 'plus';
    } catch (e) {}
    return 'fetch';
  }
  function aiOnline() {
    if (!AI_BASE) return false;
    if (aiFailCount >= 2) return false;   // 熔断：本次会话内不再反复重试
    return true;
  }
  /* 通用后端请求：支持 GET/POST + Bearer token + 超时，双通道（plus 原生 / fetch）。
     返回 Promise，成功 resolve({data, channel})，失败 reject(Error)。
     AI 对话、鉴权、同步、识别全部走这一条通道。 */
  function api(method, path, body, timeout) {
    method = (method || 'GET').toUpperCase();
    timeout = timeout || 12000;
    return new Promise(function (resolve, reject) {
      var url = API_BASE + path;
      var ch = apiTransport();
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (AUTH_TOKEN) h['Authorization'] = 'Bearer ' + AUTH_TOKEN;
        return h;
      }
      if (ch === 'plus') {
        var xhr = new plus.net.XMLHttpRequest();
        var done = false;
        function fail(msg) { if (done) return; done = true; reject(msg instanceof Error ? msg : new Error(msg)); }
        try {
          xhr.open(method, url);
          var hs = headers();
          for (var k in hs) xhr.setRequestHeader(k, hs[k]);
          xhr.timeout = timeout;
          xhr.onload = function () {
            if (done) return;
            if (xhr.status >= 200 && xhr.status < 300) {
              done = true;
              try { resolve({ data: JSON.parse(xhr.responseText), channel: 'plus' }); }
              catch (e) { reject(new Error('bad-json')); }
            } else {
              /* 同 fetch 分支：把 4xx 的业务错误体透传给调用方 */
              var err = new Error('HTTP ' + xhr.status);
              err.status = xhr.status;
              try { err.data = JSON.parse(xhr.responseText); } catch (e2) {}
              fail(err);
            }
          };
          xhr.onerror = function () { fail('network'); };
          xhr.ontimeout = function () { fail('timeout'); };
          xhr.send(body ? JSON.stringify(body) : null);
        } catch (e) { fail('exception'); }
        return;
      }
      var ctrl = null;
      try { ctrl = new AbortController(); } catch (e) {}
      var timer = setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (e) {}
        reject(new Error('timeout'));
      }, timeout);
      var opt = {
        method: method,
        headers: headers(),
        signal: ctrl ? ctrl.signal : undefined
      };
      if (body) opt.body = JSON.stringify(body);
      fetch(url, opt).then(function (r) {
        /* 4xx/5xx 时后端通常带 {"ok":false,"error":"..."}，
           必须把 body 解析出来，否则「密码错误」会被误判成「连不上服务器」 */
        return r.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var err = new Error('HTTP ' + r.status);
            err.status = r.status;
            err.data = data;
            throw err;
          }
          return data;
        });
      }).then(function (data) {
        clearTimeout(timer);
        resolve({ data: data, channel: 'fetch' });
      }).catch(function (err) {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  function aiPost(url, body, timeout) {
    // 兼容旧调用：aiPost 传的是完整 url，这里改用 path 调用
    var path = url.indexOf(API_BASE) === 0 ? url.slice(API_BASE.length) : url;
    return api('POST', path, body, timeout);
  }
  /* 页面顶部的服务状态：连上就写「已连接」，没连上老实写「本地知识库回复」，
     不做「假的已接入」。答辩时这一点经得起追问。 */
  function aiPaintNote(state) {
    var el = $('.ai-note');
    if (!el) return;
    if (!AI_BASE) {
      el.innerHTML = '本地演示模式 · 未配置 AI 服务地址 · 回复仅作辅助参考，不构成医疗诊断';
    } else if (state === 'ok') {
      el.innerHTML = '已连接 AI 服务 · 回复仅作辅助参考，不构成医疗诊断';
    } else if (state === 'kb') {
      /* 服务通了，但后端没配模型密钥，走的是同一套知识库文案 */
      el.innerHTML = '已连接 AI 服务（知识库模式）· 回复仅作辅助参考，不构成医疗诊断';
    } else if (state === 'fail' || aiFailCount >= 2) {
      el.innerHTML = 'AI 服务暂时不可达 · 已由本地知识库回复 · 仅供辅助参考';
    } else {
      el.innerHTML = '基于 DeepSeek 大模型 · 回复仅作辅助参考，不构成医疗诊断';
    }
  }
  function aiAddMsg(who, html) {
    var chat = $('#aiChat');
    if (!chat) return;
    var d = document.createElement('div');
    d.className = 'ai-msg ' + (who === 'me' ? 'me' : 'bot');
    var av = (who === 'me')
      ? ((ROLE_UI[currentRole] && ROLE_UI[currentRole].nm) || '我').slice(0, 1)
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 7V4M8 4h8"/><circle cx="9.5" cy="12" r="1" fill="#fff" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="#fff" stroke="none"/><path d="M9.5 15.5c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1"/></svg>';
    d.innerHTML = '<div class="ai-av">' + av + '</div><div class="ai-bubble">' + html + '</div>';
    chat.appendChild(d);
    var body = $('#aiBody');
    if (body) body.scrollTop = body.scrollHeight;
  }
  function aiIntent(q) {
    q = (q || '').toLowerCase();
    if (/摘要|总结|汇总/.test(q)) return 'summary';
    if (/多久|恢复|时间|什么时候|回归|重返|复出|上场|能打/.test(q)) return 'time';
    if (/解读|病例|报告|影像|检查|是什么|情况|分析/.test(q)) return 'interpret';
    if (/方案|建议|动作|怎么练|计划|禁忌|训练/.test(q)) return 'rehab';
    return null;
  }
  function aiAsk(intentOrText, isQuick) {
    if (aiBusy) { toast('AI 正在回答，请稍候'); return; }
    var intent = isQuick ? intentOrText : aiIntent(intentOrText);
    var text = isQuick ? '' : String(intentOrText || '').trim();
    if (!isQuick && !text) return;
    if (!isQuick) aiAddMsg('me', esc(text));

    var replies = aiReplies();
    var fallback = (intent && replies[intent]) || AI_FALLBACK;
    var question = isQuick ? (AI_QUICK_TEXT[intent] || text) : text;
    aiBusy = true;

    /* 没配后端：不发起请求，短暂延迟后直接给模板答案，避免任何网络错误与长时间等待 */
    if (!aiOnline()) {
      aiShowThinking();
      setTimeout(function () {
        aiHideThinking();
        aiBotSay(fallback + AI_DEMO_TAG);
        aiBusy = false;
      }, 420);
      return;
    }

    aiShowThinking();
    var settled = false;
    function finish(html) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      aiHideThinking();
      aiBotSay(html);
      aiBusy = false;
    }
    /* 兜底计时器比请求超时略长：正常由 aiPost 的 timeout 先结束 */
    var timer = setTimeout(function () {
      aiFailCount++;
      aiPaintNote('fail');
      finish(fallback + AI_DEMO_TAG);
    }, AI_API_TIMEOUT + 1500);

    aiPost(AI_BASE + '/api/ai/chat', {
      message: question,
      case_no: curCaseNo()
    }, AI_API_TIMEOUT).then(function (res) {
      if (settled) return;
      aiFailCount = 0;                 // 成功一次就恢复正常，下次照常联网
      aiChanUsed = res.channel || '';
      var data = res.data;
      /* 后端返回 source=local 表示服务通、但没配模型密钥，走的是真实病例字段拼装，
         页面上如实区分，不把「本地知识库」说成「大模型」。 */
      aiPaintNote((data && data.source === 'local') ? 'kb' : 'ok');
      if (data && data.reply) finish(aiMd(String(data.reply)));
      else finish(fallback + AI_DEMO_TAG);
    }).catch(function () {
      aiFailCount++;
      aiPaintNote('fail');
      finish(fallback + AI_DEMO_TAG);
    });
  }
  var aiThinkingEl = null;
  function aiShowThinking() {
    var chat = $('#aiChat');
    if (!chat) return;
    var d = document.createElement('div');
    d.className = 'ai-msg bot';
    d.id = 'aiThinking';
    d.innerHTML = '<div class="ai-av"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 7V4M8 4h8"/><circle cx="9.5" cy="12" r="1" fill="#fff" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="#fff" stroke="none"/><path d="M9.5 15.5c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1"/></svg></div><div class="ai-bubble ai-thinking">正在思考…</div>';
    chat.appendChild(d);
    aiThinkingEl = d;
    var body = $('#aiBody');
    if (body) body.scrollTop = body.scrollHeight;
  }
  function aiHideThinking() {
    if (aiThinkingEl && aiThinkingEl.parentNode) aiThinkingEl.parentNode.removeChild(aiThinkingEl);
    aiThinkingEl = null;
  }
  /* 轻量 Markdown 渲染：将大模型回复的 **加粗**、### 标题、- 列表、> 引用 转成 HTML */
  function aiEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /* 反向去标记：把 Markdown 还原成纯文本，供输入框编辑时使用（保留 - 和 1. 列表符号，
     这样写进库里再展示时仍能渲染成列表）。 */
  function plainText(s) {
    return String(s == null ? '' : s)
      .replace(/\r/g, '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function aiMd(text) {
    function inline(s) {
      return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
              .replace(/`([^`]+)`/g, '<code>$1</code>')
              .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    /* 先转义再套 Markdown：大模型输出属于不可信内容，直接拼 innerHTML 会有 XSS 风险 */
    var lines = aiEscape(text).replace(/\r/g, '').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) { out.push('<br>'); continue; }
      if (/^[-*_]{3,}$/.test(t)) { out.push('<div class="ai-hr"></div>'); continue; }
      if (/^#{1,4}\s+/.test(t) || /^【[^】]{1,20}】$/.test(t)) {
        out.push('<div class="ai-h">' + inline(t.replace(/^#{1,4}\s+/, '')) + '</div>');
      } else if (/^(?:&gt;|>)\s?/.test(t)) {
        out.push('<div class="ai-quote">' + inline(t.replace(/^(?:&gt;|>)\s?/, '')) + '</div>');
      } else if (/^[-*]\s+/.test(t)) {
        out.push('<div class="ai-li">' + inline(t.replace(/^[-*]\s+/, '')) + '</div>');
      } else if (/^\d+[.、]\s+/.test(t)) {
        var mo = /^(\d+)[.、]\s+(.*)$/.exec(t);
        out.push('<div class="ai-oli"><b class="n">' + mo[1] + '.</b><span>' + inline(mo[2]) + '</span></div>');
      } else {
        out.push('<p>' + inline(t) + '</p>');
      }
    }
    return out.join('');
  }
  function aiBotSay(html) {
    var chat = $('#aiChat');
    if (!chat) return;
    var d = document.createElement('div');
    d.className = 'ai-msg bot';
    d.innerHTML = '<div class="ai-av"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 7V4M8 4h8"/><circle cx="9.5" cy="12" r="1" fill="#fff" stroke="none"/><circle cx="14.5" cy="12" r="1" fill="#fff" stroke="none"/><path d="M9.5 15.5c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1"/></svg></div><div class="ai-bubble">' + html + '</div>';
    chat.appendChild(d);
    var body = $('#aiBody');
    if (body) body.scrollTop = body.scrollHeight;
  }
  $$('#aiQuick .ai-q-btn').forEach(function (b) {
    b.addEventListener('click', function () { aiAsk(b.dataset.q, true); });
  });
  $('#aiSend').addEventListener('click', function () {
    var inp = $('#aiInput');
    aiAsk(inp.value, false);
    inp.value = '';
  });
  $('#aiInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      aiAsk(this.value, false);
      this.value = '';
    }
  });

  /* =====================================================
     数据自动同步 + 下拉刷新
     1) 后端 /api/sync/version 返回业务数据版本号，网页端任何写操作会 +1；
        App 轮询到版本变化即自动重拉数据并刷新当前界面，无需手动操作。
     2) 医护端与患者端各界面支持在顶部下拉手势手动刷新。
     ===================================================== */
  var SYNC_POLL_MS = 5000;
  var lastDataVersion = null;
  var refreshBusy = false;
  var lastSyncToastAt = 0;

  function activeScreen() { return $('.screen.active'); }
  function activeBody() {
    var s = activeScreen();
    return s ? s.querySelector('.screen-body') : null;
  }
  function screenRefreshable() {
    var s = activeScreen(); if (!s) return false;
    return ['login', 'register', 'splash', 'done', 'compare', 'viewer', 'ai', 'splash']
      .indexOf(s.id) < 0;
  }
  /* 重新拉取服务器数据 + 重算当前界面（auto=自动同步触发，quiet=不弹提示） */
  function refreshFromServer(opts) {
    var o = opts || {};
    if (!SYNC_ON || !API_BASE) {
      if (!o.quiet) toast('离线演示模式 · 暂无服务器数据可刷新');
      if (o.onDone) o.onDone();
      return;
    }
    if (refreshBusy) { if (o.onDone) o.onDone(); return; }
    refreshBusy = true;
    if (o.onStart) o.onStart();
    var role = currentRole || 'patient';
    try {
      if (role === 'admin') renderAdminRemote();
      else if (role === 'patient') renderPatientRemote();
      else renderStaffRemote();
      var s = activeScreen(), id = s ? s.id : '';
      if (id === 'curve') renderCurve();
      else if (id === 'home' || id === 'me' || id === 'plan') renderAllStats();
      else if (id === 'today') renderToday();
      else if (id === 'ladder' || id === 'plan') renderProgress();
      else if (id === 'admin') { renderPending(); renderAccounts(); }
    } catch (e) {}
    setTimeout(function () {
      refreshBusy = false;
      if (o.onDone) o.onDone();
      if (!o.quiet) {
        var now = Date.now();
        if (now - lastSyncToastAt > 2500) {
          toast(o.auto ? '数据已自动同步' : '已刷新最新数据');
          lastSyncToastAt = now;
        }
      }
    }, 620);
  }
  function pollServerVersion() {
    if (!SYNC_ON || !API_BASE || !CUR_USER) return;
    if (typeof document.hidden !== 'undefined' && document.hidden) return;
    api('GET', '/api/sync/version', null, 4000).then(function (res) {
      var d = res.data || {};
      if (!d.ok || typeof d.version !== 'number') return;
      if (lastDataVersion === null) { lastDataVersion = d.version; return; }
      if (d.version !== lastDataVersion) {
        lastDataVersion = d.version;
        refreshFromServer({ auto: true });
      }
    }).catch(function () {});
  }
  function startAutoSync() {
    if (!SYNC_ON) return;
    setTimeout(pollServerVersion, 1200);
    setInterval(pollServerVersion, SYNC_POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (typeof document.hidden === 'undefined' || !document.hidden) pollServerVersion();
    });
  }

  /* ---------- 下拉刷新（各医护 / 患者界面） ---------- */
  var PTR_THRESHOLD = 60;
  function currentPtr() {
    var s = activeScreen();
    return s ? s.querySelector('.ptr') : null;
  }
  function initPullToRefresh() {
    /* 每个屏在状态栏后插一个高度可为 0 的刷新条，只在当前屏展开 */
    $$('.screen').forEach(function (s) {
      if (s.querySelector('.ptr')) return;
      var p = document.createElement('div');
      p.className = 'ptr';
      p.innerHTML = '<span class="ptr-ico"></span><span class="ptr-txt">下拉刷新</span>';
      var sb = s.querySelector('.statusbar');
      if (sb && sb.nextSibling) s.insertBefore(p, sb.nextSibling);
      else s.insertBefore(p, s.firstChild);
    });
    function setPtr(h, text, spinning) {
      var p = currentPtr(); if (!p) return;
      p.style.height = h + 'px';
      p.classList.toggle('spin', !!spinning);
      var t = p.querySelector('.ptr-txt');
      if (t && text) t.textContent = text;
    }
    function resetPtr() {
      $$('.screen .ptr').forEach(function (p) {
        p.classList.remove('drag', 'spin');
        p.style.height = '0px';
        var t = p.querySelector('.ptr-txt'); if (t) t.textContent = '下拉刷新';
      });
      dist = 0;
    }
    var startY = 0, tracking = false, dist = 0;

    document.addEventListener('touchstart', function (e) {
      if (refreshBusy || tracking || !screenRefreshable()) return;
      var b = activeBody();
      if (!b || b.scrollTop > 0 || !e.touches || !e.touches.length) return;
      startY = e.touches[0].clientY; tracking = true; dist = 0;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!tracking || refreshBusy) return;
      var b = activeBody();
      var dy = e.touches[0].clientY - startY;
      if (dy <= 0 || (b && b.scrollTop > 0)) { tracking = false; resetPtr(); return; }
      if (e.cancelable) e.preventDefault();
      dist = Math.min(90, dy * 0.5);
      var p = currentPtr(); if (p) p.classList.add('drag');
      setPtr(dist, dist >= PTR_THRESHOLD ? '松开立即刷新' : '下拉刷新', false);
    }, { passive: false });

    document.addEventListener('touchend', function () {
      if (!tracking) return;
      tracking = false;
      if (dist >= PTR_THRESHOLD) {
        setPtr(50, '正在刷新…', true);
        refreshFromServer({
          quiet: true,
          onDone: function () {
            setTimeout(function () { resetPtr(); toast('已刷新最新数据'); }, 240);
          }
        });
      } else { resetPtr(); }
    }, { passive: true });

    document.addEventListener('touchcancel', function () {
      tracking = false; resetPtr();
    }, { passive: true });
  }

  /* ---------- 启动 ---------- */
  initPullToRefresh();
  startAutoSync();
  paintDates();          // 把正文里写死的日期统一改成相对「今天」的日期
  paintMsgTimes();       // 消息中心的时间戳按相对天数动态渲染
  renderProgress();      // 首页 / 周计划进度与今日实际打卡同步
  renderAllStats();      // 首页环形 / 我的页恢复度与连续天数，读本地落盘值
  syncRoleUI();          // 登录页按当前身份初始化显隐
  probeServer();         // 先探测服务器，避免点登录后干等超时
  var ALL = /[#&?]all/.test(location.href);
  if (ALL) {
    document.body.classList.add('all-screens');
    $('#tabbar').style.display = 'none';
    renderCurve();
  } else {
    /* 恢复登录态：本地有 token 就直接进对应角色页，不用重新登录 */
    var authed = SYNC_ON && loadAuth();
    if (authed && CUR_USER) {
      var innerRole = ROLE_MAP[CUR_USER.role] || 'patient';
      applyRole(innerRole, CUR_USER.name);
      stack = [homeFor(innerRole)]; show(homeFor(innerRole));
      if (innerRole === 'admin') renderAdminRemote();
      else if (innerRole === 'patient') renderPatientRemote();
      else renderStaffRemote();
    } else {
      show('splash');
      setTimeout(function () { go('login'); }, 1200);
    }
  }

  /* 供原生壳（HBuilderX web-view / 5+）调用的导航钩子 */
  window.toast = toast;
  window.__appBack = back;
  window.__appCanBack = function () { return stack.length > 1; };
})();

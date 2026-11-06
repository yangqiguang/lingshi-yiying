/* =====================================================
   灵视医影 · 工作台交互（原生 JS，无依赖）
   ===================================================== */
(function () {
  'use strict';

  // 公共工具：DOM 快捷方式与带 token 的请求（必须在使用前定义）
  var $ = function (id) { return document.getElementById(id); };
  var API = window.Auth ? window.Auth.fetch : fetch;

  /* ---------- toast ---------- */
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  /* ---------- 视图路由 ---------- */
  var crumbs = {
    dashboard: '总览', analysis: '影像分析', review: '待审核队列',
    report: '结构化报告', archive: '病例与康复档案', rehab: '康复方案制定',
    return: '运动回归管理', analytics: '数据分析看板', stats: '统计与设置',
    'ai-assist': 'AI 影像助手', 'case-detail': '病例详情'
  };

  /* ---------- 角色权限 ---------- */
  var roleMap = {
    '影像技师':   { name: '影像技师', default: 'analysis', views: ['dashboard', 'analysis', 'archive', 'case-detail', 'ai-assist'] },
    '执业医师':   { name: '执业医师', default: 'review',   views: ['dashboard', 'review', 'archive', 'case-detail', 'ai-assist'] },
    '康复治疗师': { name: '康复治疗师', default: 'rehab',  views: ['dashboard', 'archive', 'rehab', 'case-detail', 'ai-assist'] },
    '患者':       { name: '患者',     default: 'archive',  views: ['archive', 'case-detail'] },
    '机构管理员': { name: '机构管理员', default: 'dashboard', views: ['dashboard', 'analysis', 'review', 'archive', 'case-detail', 'rehab', 'return', 'analytics', 'stats', 'ai-assist'] }
  };
  // 从本地缓存的用户信息读角色，不再从 URL 读
  var currentRole = '执业医师';
  try {
    var cached = JSON.parse(localStorage.getItem('lingshi_user') || 'null');
    if (cached && cached.role) currentRole = cached.role;
  } catch (e) {}
  var myPerms = roleMap[currentRole] || roleMap['执业医师'];
  var realName = (window.Auth && Auth.getUser()) ? Auth.getUser().name : myPerms.name;

  // 隐藏当前角色无权限的侧边栏入口
  document.querySelectorAll('.side-link[data-view]').forEach(function (l) {
    var v = l.getAttribute('data-view');
    if (myPerms.views.indexOf(v) === -1) l.style.display = 'none';
  });
  // 隐藏因此没有任何可见入口的分组标题
  document.querySelectorAll('.side-group').forEach(function (g) {
    var sib = g.nextElementSibling, hasVisible = false;
    while (sib && !sib.classList.contains('side-group')) {
      if (sib.classList.contains('side-link') && sib.style.display !== 'none') { hasVisible = true; break; }
      sib = sib.nextElementSibling;
    }
    if (!hasVisible) g.style.display = 'none';
  });

  /* ---------- 角色显示 ---------- */
  var chip = document.getElementById('role-chip');
  if (chip) chip.textContent = currentRole;
  var topUser = document.getElementById('top-user');
  if (topUser) topUser.textContent = realName;
  var accRole = document.getElementById('acc-role');
  if (accRole) accRole.textContent = currentRole;
  var accAvatar = document.getElementById('acc-avatar');
  if (accAvatar) accAvatar.textContent = currentRole.charAt(0);
  var topAvatar = document.getElementById('top-avatar');
  if (topAvatar) topAvatar.textContent = currentRole.charAt(0);
  var accName = document.getElementById('acc-name');
  if (accName) accName.textContent = realName;

  var links = document.querySelectorAll('.side-link[data-view]');

  function switchView(name) {
    if (!crumbs[name]) return;
    if (myPerms.views.indexOf(name) === -1) {
      toast('当前角色无权访问此页面');
      return;
    }
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var target = document.getElementById('view-' + name);
    if (target) target.classList.add('active');
    links.forEach(function (l) { l.classList.toggle('active', l.getAttribute('data-view') === name); });
    var crumb = document.getElementById('crumb');
    if (crumb) crumb.innerHTML = '工作台 / <b>' + crumbs[name] + '</b>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    ensureCharts(name);
    // 视图刚显示时图片可能还处于 display:none，尺寸为 0，需要重算检测框位置
    relayoutAllBoxes();
    setTimeout(relayoutAllBoxes, 120);
    if (name === 'rehab') {
      var sel = document.getElementById('rehab-case-select');
      if (sel && sel.value) loadRehabCase(sel.value);
    }
    if (name === 'return') loadReturnView();
    if (name === 'stats' && currentRole === '机构管理员') {
      loadUsersTable();
      loadUnboundCases();
    }
    if (name === 'archive') {
      refreshNewCaseBtn();
      var bindBtnEl = $('btn-bind-toggle');
      if (bindBtnEl) bindBtnEl.hidden = currentRole !== '患者';
    }
  }
  window.__switchView = switchView;

  links.forEach(function (l) {
    l.addEventListener('click', function () {
      var v = l.getAttribute('data-view');
      if (v) switchView(v);
      var sb = document.getElementById('app-sidebar');
      if (sb) sb.classList.remove('open');
    });
  });

  /* data-goto 通用跳转 */
  document.querySelectorAll('[data-goto]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      switchView(el.getAttribute('data-goto'));
    });
  });

  /* data-toast 通用提示 */
  document.querySelectorAll('[data-toast]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      toast(el.getAttribute('data-toast'));
    });
  });

  /* ---------- 病例库搜索（按病例号 / 部位实时过滤） ---------- */
  var arcInput = document.getElementById('archive-search');
  var arcBtn = document.getElementById('archive-search-btn');
  function applyArchiveFilter(announce) {
    if (!arcInput) return;
    var raw = arcInput.value || '';
    var kw = raw.trim().toLowerCase();
    var rows = document.querySelectorAll('#view-archive .data-table tbody tr');
    var n = 0;
    rows.forEach(function (tr) {
      var hit = !kw || tr.textContent.toLowerCase().indexOf(kw) !== -1;
      tr.style.display = hit ? '' : 'none';
      if (hit) n++;
    });
    if (announce) toast(kw ? (n ? ('找到 ' + n + ' 条匹配病例') : ('未找到匹配“' + raw.trim() + '”的病例')) : '已显示全部病例');
  }
  if (arcInput) {
    arcInput.addEventListener('input', function () { applyArchiveFilter(false); });
    arcInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyArchiveFilter(true); } });
    if (arcBtn) arcBtn.addEventListener('click', function () { applyArchiveFilter(true); });
  }

  /* 规划中入口（移动端等）点击提示，避免死按钮 */
  document.querySelectorAll('[data-placeholder]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      toast(el.getAttribute('data-placeholder'));
    });
  });

  /* 打印 / 导出 PDF（结构化报告） */
  document.querySelectorAll('[data-print]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      toast('正在调用浏览器打印，可选择"另存为 PDF"');
      setTimeout(function () { window.print(); }, 300);
    });
  });

  /* 科研数据导出（调用后端真实接口） */
  function downloadBlob(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  document.querySelectorAll('[data-export]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      var fmt = el.getAttribute('data-export') || 'csv';
      var token = window.Auth ? Auth.getToken() : '';
      // CSV 直接下载
      if (fmt === 'csv') {
        var url = '/api/export?format=csv&token=' + encodeURIComponent(token);
        window.open(url, '_blank');
        toast('正在导出 CSV...');
      } else {
        // JSON 先 fetch 再生成文件
        API('/api/export?format=json').then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) {
            var stamp = new Date().toISOString().slice(0, 10);
            downloadBlob('灵视医影_科研数据_' + stamp + '.json', JSON.stringify(d, null, 2), 'application/json;charset=utf-8');
            toast('已导出 JSON（共 ' + d.count + ' 条）');
          } else {
            toast('导出失败：' + (d.error || '未知错误'));
          }
        }).catch(function () { toast('导出失败'); });
      }
    });
  });

  /* 移动端侧边栏 */
  var st = document.getElementById('side-toggle');
  if (st) st.addEventListener('click', function () {
    var sb = document.getElementById('app-sidebar');
    if (sb) sb.classList.toggle('open');
  });

  /* ---------- 影像选择（真文件选择） ---------- */
  var pick = document.getElementById('pick-file');
  var fileInput = document.getElementById('file-input');
  var fileName = document.getElementById('file-name');
  var selectedFile = null;
  var lastResult = null;

  /* ---------- 检测框渲染：按图片实际显示区域定位，百分比即原图比例 ---------- */
  function layoutBoxLayer(viewer, img, layer) {
    if (!viewer || !img || !layer) return;
    var iw = img.naturalWidth || 0, ih = img.naturalHeight || 0;
    if (!iw || !ih) { layer.style.width = '0px'; layer.style.height = '0px'; return; }
    var vw = viewer.clientWidth, vh = viewer.clientHeight;
    var scale = Math.min(vw / iw, vh / ih);
    var w = iw * scale, h = ih * scale;
    layer.style.width = w + 'px';
    layer.style.height = h + 'px';
    layer.style.left = ((vw - w) / 2) + 'px';
    layer.style.top = ((vh - h) / 2) + 'px';
  }

  function renderBoxes(viewerId, imgId, layerId, findings) {
    var viewer = $(viewerId), img = $(imgId), layer = $(layerId);
    if (!viewer || !img || !layer) return;
    layer.innerHTML = '';
    (findings || []).forEach(function (f) {
      if (!f.bbox || f.bbox.length !== 4) return;
      var b = f.bbox;
      var box = document.createElement('div');
      box.className = 'bbox' +
        (f.source === 'doctor' ? ' is-doctor' : (f.label === '未见明确骨折' ? ' is-normal' : ''));
      box.style.left = (b[0] * 100).toFixed(2) + '%';
      box.style.top = (b[1] * 100).toFixed(2) + '%';
      box.style.width = Math.max(0.8, (b[2] - b[0]) * 100).toFixed(2) + '%';
      box.style.height = Math.max(0.8, (b[3] - b[1]) * 100).toFixed(2) + '%';
      var lab = document.createElement('span');
      lab.className = 'bbox-lab';
      lab.textContent = f.label + ' ' + Math.round(f.confidence * 100) + '%';
      box.appendChild(lab);
      layer.appendChild(box);
    });
    layoutBoxLayer(viewer, img, layer);
  }

  function relayoutAllBoxes() {
    layoutBoxLayer($('wb-viewer-b'), $('wb-ai-img'), $('wb-box-layer-b'));
    layoutBoxLayer($('ai-viewer'), $('ai-img'), $('detail-box-layer'));
  }
  window.addEventListener('resize', relayoutAllBoxes);
  ['wb-original-img', 'wb-ai-img', 'ai-img', 'detail-original-img'].forEach(function (id) {
    var img = $(id);
    if (img) img.addEventListener('load', relayoutAllBoxes);
  });

  function setViewerImage(viewerId, imgId, url, hasImage) {
    var viewer = $(viewerId), img = $(imgId);
    if (viewer) viewer.classList.toggle('no-image-shown', !hasImage);
    if (img && url) img.src = url;
  }

  function renderFindingsList(el, findings, meta) {
    if (!el) return;
    el.innerHTML = '';
    if (!findings || !findings.length) {
      el.innerHTML = '<div class="empty-note" style="text-align:left;">模型未检出高于阈值的可疑区域，请人工阅片确认。</div>';
      return;
    }
    findings.forEach(function (f, i) {
      var pct = Math.round(f.confidence * 100);
      var div = document.createElement('div');
      div.className = 'find-item';
      var pos = f.bbox
        ? '框位置 ' + f.bbox.map(function (x) { return Number(x).toFixed(2); }).join(' / ')
        : '整幅影像判读';
      var badgeClass = f.source === 'doctor' ? 'amber' : (f.label === '未见明确骨折' ? 'teal' : 'red');
      div.innerHTML =
        '<div class="find-top"><b>' + (f.bbox ? '区域 ' + (i + 1) : '整体判读') + ' · ' + f.label + '</b>' +
        '<span class="badge ' + badgeClass + '">' + (f.source === 'doctor' ? '人工' : '置信 ' + pct + '%') + '</span></div>' +
        '<div class="find-pos">类别 ' + (f.raw_label || '—') + ' · 来源 ' +
        (f.source === 'model' ? '模型检测' : (f.source || '—')) + ' · ' + pos + '</div>' +
        '<div class="conf-bar"><i style="width:' + pct + '%"></i></div>';
      el.appendChild(div);
    });
    if (meta && meta.model) {
      var chip = document.createElement('div');
      chip.className = 'model-chip';
      chip.textContent = '模型 ' + meta.model.name + ' · 版本 ' + meta.model.version +
        ' · 阈值 ' + meta.model.conf_threshold;
      el.appendChild(chip);
    }
  }

  /* ---------- 模型状态 ---------- */
  var MODEL_INFO = null;
  var modelRetry = 0;

  function offlineHint() {
    if (location.protocol === 'file:') {
      return '当前是直接打开的本地文件，请改用 http://127.0.0.1:5000/login.html';
    }
    return '请先在 server 目录运行 python app.py，再从 http://127.0.0.1:5000/login.html 进入';
  }

  function checkModel() {
    var chip = $('model-chip');
    fetch('/api/model/status', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!chip) return;
      var m = d.model || {};
      MODEL_INFO = m;
      if (d.ok && m.available) {
        modelRetry = 0;
        chip.className = 'model-chip ok';
        chip.textContent = '检测模型已就绪 · ' + m.model_name + ' · ' + m.model_version +
          ' · ' + m.model_size_mb + ' MB';
      } else {
        chip.className = 'model-chip err';
        chip.textContent = '检测模型未就绪：' + (m.error || '未知原因');
      }
    }).catch(function () {
      if (chip) {
        chip.className = 'model-chip err';
        chip.textContent = '无法连接后端服务 · ' + offlineHint();
        chip.title = '需要先启动 Flask 后端；启动后本行会自动恢复';
      }
      // 服务起来后自动恢复（最多重试 24 次 ≈ 2 分钟）
      if (modelRetry++ < 24) setTimeout(checkModel, 5000);
    });
  }
  checkModel();

  /* ---------- 选择文件 / 示例片 ---------- */
  function setSelectedFile(file) {
    selectedFile = file;
    if (fileName) fileName.textContent = '已选择：' + file.name + '（' + Math.round(file.size / 1024) + ' KB）';
    var url = URL.createObjectURL(file);
    setViewerImage('wb-viewer-a', 'wb-original-img', url, true);
    setViewerImage('wb-viewer-b', 'wb-ai-img', url, true);
    var layer = $('wb-box-layer-b');
    if (layer) layer.innerHTML = '';
    toast('已加载：' + file.name);
  }

  if (pick && fileInput) pick.addEventListener('click', function () { fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) setSelectedFile(fileInput.files[0]);
  });

  document.querySelectorAll('.sample-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var n = btn.getAttribute('data-sample');
      btn.disabled = true;
      fetch('assets/samples/sample-' + n + '.jpg')
        .then(function (r) {
          if (!r.ok) throw new Error('示例片缺失');
          return r.blob();
        })
        .then(function (blob) { return new File([blob], 'sample-' + n + '.jpg', { type: 'image/jpeg' }); })
        .then(function (f) { setSelectedFile(f); btn.disabled = false; })
        .catch(function (e) { btn.disabled = false; toast('示例片加载失败：' + e.message); });
    });
  });

  /* ---------- 分析流程：真实上传 + 模型推理 ---------- */
  var run = document.getElementById('run-analysis');
  var prep = document.getElementById('prep-steps');
  var panel = document.getElementById('workbench-panel');

  function setBusy(busy) {
    if (!run) return;
    run.disabled = busy;
    run.textContent = busy ? '分析中…' : '重新分析';
  }

  if (run) run.addEventListener('click', function () {
    if (!selectedFile) { toast('请先选择影像文件'); return; }
    setBusy(true);
    if (prep) {
      prep.style.display = 'block';
      prep.innerHTML = '<div>已提交影像，正在执行模型推理并生成报告…（CPU 推理通常 &lt; 0.3 秒，报告生成视网络而定）</div>';
    }
    var fd = new FormData();
    fd.append('file', selectedFile);
    var fieldMap = {
      'form-case-no': 'case_no', 'form-modality': 'modality', 'form-part': 'part',
      'form-date': 'injury_date', 'form-sport': 'sport',
      'form-patient-name': 'patient_name', 'form-patient-phone': 'patient_phone'
    };
    Object.keys(fieldMap).forEach(function (id) {
      var el = $(id);
      if (el && el.value && el.value.trim()) fd.append(fieldMap[id], el.value.trim());
    });

    API('/api/analyze', { method: 'POST', body: fd })
      .then(function (r) {
        return r.json().then(function (d) { return { status: r.status, body: d }; });
      })
      .then(function (res) {
        var d = res.body;
        if (!d.ok) throw new Error(d.error || ('HTTP ' + res.status));
        lastResult = d.result;
        renderAnalysis(d.result);
        loadReviewList();
        loadSummary();
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : '网络错误';
        // fetch 直接被拒绝 = 后端没起来（不是业务报错）
        if (/Failed to fetch|NetworkError|Load failed|network error/i.test(msg)) {
          msg = '未连接后端服务。' + offlineHint();
          checkModel();
        }
        if (prep) prep.innerHTML = '<div style="color:#b91c1c;">分析失败：' + msg + '</div>';
        toast('分析失败：' + msg);
      })
      .then(function () { setBusy(false); });
  });

  function renderAnalysis(res) {
    if (panel) panel.style.display = 'block';
    if (res.case_no) { currentCaseNo = res.case_no; setAiCaseLine(); }
    var caseNoEl = $('wb-case-no');
    if (caseNoEl) caseNoEl.textContent = res.case_no;

    var badge = $('wb-finding-badge');
    if (badge) {
      badge.textContent = res.finding_label + ' · ' + Math.round((res.confidence || 0) * 100) + '%';
      badge.className = 'badge ' + (res.has_fracture ? 'red' : 'teal');
    }

    var token = window.Auth ? Auth.getToken() : '';
    var url = res.image_url ? res.image_url + '?token=' + encodeURIComponent(token) : '';
    setViewerImage('wb-viewer-a', 'wb-original-img', url, !!url);
    setViewerImage('wb-viewer-b', 'wb-ai-img', url, !!url);
    renderBoxes('wb-viewer-b', 'wb-ai-img', 'wb-box-layer-b', res.findings);
    renderFindingsList($('wb-findings'), res.findings, res);

    if (prep) {
      prep.innerHTML = '<div style="color:#0f766e;">完成：推理 ' +
        (res.model ? res.model.elapsed_ms : '—') + ' ms' +
        (res.warning ? '（' + res.warning + '）' : '') + '</div>';
    }
    var sum = $('wb-summary');
    if (sum) {
      sum.innerHTML =
        '病例号：<b>' + res.case_no + '</b><br>' +
        '患者：' + escapeHtml(res.patient_name || '未填写') + '<br>' +
        '部位：' + res.part + '<br>' +
        '模型结论：<b>' + res.finding_label + '</b>（' + Math.round((res.confidence || 0) * 100) + '%）<br>' +
        '影像：' + (res.image ? res.image.width + '×' + res.image.height : '—') +
        ' · 推理 ' + (res.model ? res.model.elapsed_ms : '—') + ' ms<br>' +
        '<span style="color:#b45309;">模型结果已生成，请核对影像后完成下方报告并提交医师审核。</span>';
    }
    var tarea = $('wb-tech-report');
    /* 输入框里放纯文本（去掉 ** / # 这类标记），星号不直接暴露给技师；
       同时把大模型原文渲染成「预览」，以格式化后的样子呈现给医师端。 */
    if (tarea) tarea.value = plainText(res.ai_report || '');
    paintReportPreview(res.ai_report || '');
    var tstat = $('wb-tech-status');
    if (tstat) { tstat.textContent = res.status || '报告撰写中'; tstat.className = 'badge amber'; }
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('分析完成：' + res.finding_label + '（' + res.case_no + '）');
  }

  /* ---------- 影像技师：保存 / 提交检查报告 ---------- */
  function techReportAction(submit) {
    if (!lastResult || !lastResult.case_no) { toast('请先完成一次分析'); return; }
    var tarea = $('wb-tech-report');
    var content = tarea ? tarea.value.trim() : '';
    if (submit && !content) { toast('提交前请先填写检查报告'); return; }
    API('/api/cases/' + encodeURIComponent(lastResult.case_no) + '/tech-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content, submit: !!submit })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { toast(d.error || '保存失败'); return; }
      toast(submit ? '已提交医师审核' : '草稿已保存');
      var tstat = $('wb-tech-status');
      if (tstat) {
        tstat.textContent = d.status;
        tstat.className = 'badge ' + (d.status === '待审核' ? 'amber' : (d.status === '已审核' ? 'teal' : 'gray'));
      }
      loadReviewList();
      loadSummary();
      lastResult.status = d.status;
    }).catch(function () { toast('网络错误'); });
  }
  var wbTechSave = $('wb-tech-save');
  if (wbTechSave) wbTechSave.addEventListener('click', function () { techReportAction(false); });
  var wbTechSubmit = $('wb-tech-submit');
  if (wbTechSubmit) wbTechSubmit.addEventListener('click', function () { techReportAction(true); });

  /* ---------- 报告渲染预览：AI 初稿里的 Markdown 变成真正的排版 ---------- */
  function paintReportPreview(raw) {
    var wrap = $('wb-report-preview-wrap');
    var box = $('wb-report-preview');
    if (!wrap || !box) return;
    var v = String(raw == null ? '' : raw).trim();
    if (!v) { wrap.style.display = 'none'; box.innerHTML = ''; return; }
    wrap.style.display = '';
    box.innerHTML = mdToHtml(v);
  }

  var wbTechArea = $('wb-tech-report');
  if (wbTechArea) {
    wbTechArea.addEventListener('input', function () { paintReportPreview(wbTechArea.value); });
  }

  var openCaseBtn = $('wb-open-case');
  if (openCaseBtn) openCaseBtn.addEventListener('click', function () {
    if (!lastResult) { toast('请先完成一次分析'); return; }
    showCaseDetail({ case_no: lastResult.case_no });
  });
  var reanalyzeBtn = $('wb-reanalyze');
  if (reanalyzeBtn) reanalyzeBtn.addEventListener('click', function () {
    if (fileInput) fileInput.click();
  });

  /* ---------- 阅片工具按钮 ---------- */
  document.querySelectorAll('.viewer-tools .tool-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var parent = b.parentElement;
      parent.querySelectorAll('.tool-btn').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
    });
  });

  /* ---------- 退出登录 / 切换账号 ---------- */
  function backToLogin(msg, url) {
    toast(msg);
    setTimeout(function () { window.location.href = url || 'login.html'; }, 900);
  }
  var btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', function () {
    backToLogin('已退出登录，正在返回登录页…', 'login.html?switch=1');
  });
  var btnSwitch = document.getElementById('btn-switch-account');
  if (btnSwitch) btnSwitch.addEventListener('click', function () {
    backToLogin('正在切换账号，请在登录页重新选择账号与角色…', 'login.html?switch=1');
  });

  /* ---------- 顶栏账号下拉菜单（所有角色可见的退出入口） ---------- */
  var userMenu = document.getElementById('user-menu');
  var userMenuBtn = document.getElementById('user-menu-btn');
  var userDropdown = document.getElementById('user-dropdown');
  function closeUserMenu() {
    if (!userMenu) return;
    userMenu.classList.remove('open');
    if (userDropdown) userDropdown.hidden = true;
    if (userMenuBtn) userMenuBtn.setAttribute('aria-expanded', 'false');
  }
  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (userMenu.classList.contains('open')) { closeUserMenu(); return; }
      userMenu.classList.add('open');
      userDropdown.hidden = false;
      userMenuBtn.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('click', function (e) {
      if (userMenu && !userMenu.contains(e.target)) closeUserMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeUserMenu();
    });
  }
  var topLogout = document.getElementById('top-logout');
  if (topLogout) topLogout.addEventListener('click', function () {
    closeUserMenu();
    backToLogin('已退出登录，正在返回登录页…', 'login.html?switch=1');
  });
  var topSwitch = document.getElementById('top-switch-account');
  if (topSwitch) topSwitch.addEventListener('click', function () {
    closeUserMenu();
    backToLogin('正在切换账号，请在登录页重新选择账号与角色…', 'login.html?switch=1');
  });

  /* ---------- 影像前后对比滑块（clip-path reveal） ---------- */
  (function () {
    var stage = document.getElementById('compare-stage');
    var top = document.getElementById('cmp-top');
    var handle = document.getElementById('cmp-handle');
    if (!stage || !top || !handle) return;
    function setPos(pct) {
      pct = Math.max(2, Math.min(98, pct));
      top.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
      handle.style.left = pct + '%';
    }
    function fromEvent(e) {
      var r = stage.getBoundingClientRect();
      var x = (e.clientX != null ? e.clientX : (e.touches && e.touches[0].clientX)) - r.left;
      setPos(x / r.width * 100);
    }
    var dragging = false;
    function start(e) { dragging = true; fromEvent(e); if (e.cancelable) e.preventDefault(); }
    function move(e) { if (dragging) fromEvent(e); }
    function end() { dragging = false; }
    stage.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    setPos(50);
  })();

  /* ---------- hash 路由直达 ---------- */
  function fromHash() {
    var h = location.hash.replace('#', '');
    if (crumbs[h]) switchView(h);
  }
  window.addEventListener('hashchange', fromHash);

  /* ================= ECharts 数据看板（懒加载） ================= */
  var BLUE = '#2563eb', TEAL = '#0ea5a0', PURPLE = '#7c3aed', AMBER = '#f59e0b', RED = '#ef4444';
  var chartInstances = {};

  function grad(c1, c2) {
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c1 }, { offset: 1, color: c2 }]);
  }
  function makeChart(id, option) {
    var dom = document.getElementById(id);
    if (!dom || typeof echarts === 'undefined') return;
    var c = echarts.getInstanceByDom(dom);
    if (!c) { c = echarts.init(dom); chartInstances[id] = c; }
    c.setOption(option);
  }
  function resizeAll() {
    Object.keys(chartInstances).forEach(function (k) { if (chartInstances[k]) chartInstances[k].resize(); });
  }


  function ensureCharts(view) {
    if (typeof echarts === 'undefined') return;
    // 统计/分析看板的图表统一由 loadCharts() 用后端真实数据渲染
    if (view === 'analytics' || view === 'stats') loadCharts();
    setTimeout(resizeAll, 60);
  }
  window.addEventListener('resize', resizeAll);

  /* ================= AI 影像助手（DeepSeek） ================= */
  var BOT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2"><rect x="5" y="7" width="14" height="11" rx="2"/><circle cx="9.5" cy="12" r="1" fill="#fff"/><circle cx="14.5" cy="12" r="1" fill="#fff"/></svg>';
  var USER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>';

  var aiMessages = document.getElementById('ai-messages');
  var aiInput = document.getElementById('ai-input');

  function addAIMsg(payload, isUser) {
    if (!aiMessages) return null;
    var wrap = document.createElement('div');
    wrap.className = 'ai-msg ' + (isUser ? 'user' : 'bot');
    var bubble = document.createElement('div');
    bubble.className = 'ai-bubble ' + (isUser ? 'user-bubble' : 'bot-bubble');
    if (isUser) { bubble.textContent = payload; } else { bubble.innerHTML = payload; }
    var avatar = document.createElement('div');
    avatar.className = 'ai-avatar ' + (isUser ? 'user' : 'bot') + ' sm';
    avatar.innerHTML = isUser ? USER_ICON : BOT_ICON;
    if (isUser) { wrap.appendChild(bubble); wrap.appendChild(avatar); }
    else { wrap.appendChild(avatar); wrap.appendChild(bubble); }
    aiMessages.appendChild(wrap);
    aiMessages.scrollTop = aiMessages.scrollHeight;
    return wrap;
  }

  /* 轻量 Markdown → HTML：把 **粗体**、*斜体*、`代码`、- / 1. 列表、### 标题、> 引用
     渲染成真正的排版，避免把 * 星号原样显示给用户。
     大模型输出属于不可信内容，所以先转义、再套标签，防止 XSS。 */
  function mdToHtml(text) {
    var s = escapeHtml(String(text == null ? '' : text)).replace(/\r/g, '');

    function inline(t) {
      return t
        .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
        .replace(/__([^_\n]+?)__/g, '<b>$1</b>')
        .replace(/(^|[\s（(])\*([^*\n]+?)\*(?=[\s）)。，,.;；:：]|$)/g, '$1<i>$2</i>')
        .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }

    var out = [], listTag = '';
    function closeList() { if (listTag) { out.push('</' + listTag + '>'); listTag = ''; } }

    s.split('\n').forEach(function (ln) {
      var t = ln.trim();
      if (!t) { closeList(); out.push('<div class="md-gap"></div>'); return; }

      /* --- 分隔线 --- */
      if (/^([-*_])\1{2,}$/.test(t)) { closeList(); out.push('<hr class="md-hr">'); return; }

      /* - 无序列表 */
      var m = /^\s*[-*·•]\s+(.*)$/.exec(ln);
      if (m) {
        if (listTag !== 'ul') { closeList(); out.push('<ul class="md-ul">'); listTag = 'ul'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        return;
      }

      /* 1. / 1、/ 1) 有序列表 */
      m = /^\s*\d+\s*[.、)）]\s*(.*)$/.exec(ln);
      if (m) {
        if (listTag !== 'ol') { closeList(); out.push('<ol class="md-ol">'); listTag = 'ol'; }
        out.push('<li>' + inline(m[1]) + '</li>');
        return;
      }

      closeList();

      /* ### 标题 */
      var h = /^\s*#{1,6}\s+(.+)$/.exec(ln);
      if (h) { out.push('<div class="md-h">' + inline(h[1]) + '</div>'); return; }

      /* > 引用（注意：先做了 HTML 转义，行首的 > 已变成 &gt;） */
      var q = /^\s*(?:>|&gt;)\s?(.*)$/.exec(ln);
      if (q) { out.push('<div class="md-quote">' + inline(q[1]) + '</div>'); return; }

      /* 【影像所见】这类中文小标题也当标题排版 */
      if (/^【[^】]{1,20}】/.test(t)) { out.push('<div class="md-h">' + inline(t) + '</div>'); return; }

      out.push('<p>' + inline(ln) + '</p>');
    });
    closeList();
    return out.join('');
  }

  /* 只读区域用：有内容就渲染 Markdown，空则显示灰色占位 */
  function setRich(id, text, emptyHint) {
    var el = $(id);
    if (!el) return;
    var v = String(text == null ? '' : text).trim();
    if (!v) { el.textContent = emptyHint || '—'; }
    else { el.innerHTML = mdToHtml(v); }
    el.classList.toggle('is-empty', !v);
  }

  /* 写入 textarea/输入框时去掉标记符号，保持纯文本可编辑 */
  function plainText(text) {
    return String(text == null ? '' : text)
      .replace(/\*\*/g, '').replace(/__/g, '')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/`/g, '');
  }

  function sendAI(text) {
    if (!text || !text.trim()) return;
    addAIMsg(text.trim(), true);
    if (aiInput) aiInput.value = '';
    var thinking = addAIMsg('正在思考…', false);
    var API = window.Auth ? window.Auth.fetch : fetch;
    var payload = { message: text.trim() };
    if (currentCaseNo) payload.case_no = currentCaseNo;

    API('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!thinking) return;
      if (!d.ok) {
        thinking.querySelector('.ai-bubble').innerHTML =
          '<div style="color:#b91c1c;">' + escapeHtml(d.error || 'AI 服务暂时不可用') + '</div>';
        return;
      }
      var tag = d.source === 'model'
        ? ' · 大模型回答（已注入当前病例数据）'
        : ' · 本地回答（仅取当前病例档案字段，未调用大模型）';
      thinking.querySelector('.ai-bubble').innerHTML =
        mdToHtml(d.reply || '') +
        '<div class="ai-note" style="margin-top:6px;font-size:12px;opacity:.75;">' +
        escapeHtml((d.case_no ? '病例 ' + d.case_no : '未选择病例') + tag) + '</div>';
      if (aiMessages) aiMessages.scrollTop = aiMessages.scrollHeight;
    }).catch(function () {
      if (thinking) {
        thinking.querySelector('.ai-bubble').innerHTML =
          '<div style="color:#b91c1c;">网络错误：未连接后端服务，请确认 python app.py 已启动。</div>';
      }
    });
  }

  /* AI 面板顶部显示当前病例，避免"已接入当前病例"与实际不符 */
  function setAiCaseLine() {
    var el = document.getElementById('ai-case-line');
    if (!el) return;
    el.textContent = currentCaseNo
      ? ('已接入当前病例 ' + currentCaseNo + ' · 基于阿里云百炼大模型')
      : '未选择病例 · 请先打开病例再提问';
  }

  document.querySelectorAll('.ai-q-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      sendAI(btn.textContent.trim(), btn.getAttribute('data-q'));
    });
  });
  if (aiInput) {
    aiInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendAI(aiInput.value);
    });
    var aiSendBtn = document.getElementById('ai-send');
    if (aiSendBtn) aiSendBtn.addEventListener('click', function () { sendAI(aiInput.value); });
  }

  /* ============================================================
   * 后端 API 对接（覆盖原版静态数据）
   * ============================================================ */
  // $ / API 已在文件顶部定义

  /* ---------- 真实用户信息（覆盖写死的角色） ---------- */
  API('/api/auth/me').then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) return;
    var u = d.user;
    var nameEl = $('top-user'), roleEl = $('role-chip'), avatarEl = $('top-avatar');
    if (nameEl) nameEl.textContent = u.name;
    if (roleEl) roleEl.textContent = u.role;
    if (avatarEl) avatarEl.textContent = u.name.charAt(0);
    var accName = $('acc-name'), accRole = $('acc-role'), accAvatar = $('acc-avatar');
    if (accName) accName.textContent = u.name;
    if (accRole) accRole.textContent = u.role + ' · ' + (u.phone || '');
    if (accAvatar) accAvatar.textContent = u.name.charAt(0);
  }).catch(function () {});

  /* ---------- 病例列表：待审核队列 / 档案 / 待办 / 康复下拉 ---------- */
  var casesCache = [];
  var currentCaseNo = '';   // 当前打开的病例：AI 助手 / 运动回归都以它为准
  // 事件委托（捕获阶段，先于原版 data-toast 触发）
  document.addEventListener('click', function (e) {
    var tr = e.target.closest('#view-review tbody tr[data-case-no]');
    if (!tr) return;
    e.stopPropagation();
    openCaseByNo(tr.getAttribute('data-case-no'));
  }, true);

  function fmtTime(s) {
    if (!s) return '—';
    try {
      var d = new Date(s);
      if (isNaN(d.getTime())) return s;
      var p = function (n) { return n < 10 ? '0' + n : '' + n; };
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return s; }
  }

  function statusBadge(status) {
    var cls = 'gray';
    if (status === '报告撰写中') cls = 'blue';
    else if (status === '待审核') cls = 'amber';
    else if (status === '已审核') cls = 'teal';
    else if (status === '已驳回') cls = 'red';
    return '<span class="badge ' + cls + '">' + escapeHtml(status) + '</span>';
  }

  function firstLine(s, n) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '—';
    return t.length > (n || 24) ? t.slice(0, n || 24) + '…' : t;
  }

  /* ---------- 总览 KPI：全部取后端真实计数 ---------- */
  function setKpi(id, num, sub) {
    var kpi = document.getElementById(id);
    if (!kpi) return;
    var n = kpi.querySelector('.k-num');
    if (n) n.textContent = num;
    var s = kpi.querySelector('.k-sub');
    if (s && sub) s.textContent = sub;
  }

  function partsText(parts) {
    if (!parts || !parts.length) return '今日暂无新分析';
    return parts.slice(0, 3).map(function (p) { return p.part + ' ' + p.count; }).join(' / ');
  }

  function loadSummary() {
    API('/api/summary').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok || !d.summary) return;
      var s = d.summary;
      setKpi('kpi-pending', s.pending, s.draft ? s.draft + ' 例技师仍在写报告' : '技师提交后进入队列');
      setKpi('kpi-today', s.analyzed_today, partsText(s.today_parts));
      setKpi('kpi-rehab', s.in_rehab, '已归档 ' + s.confirmed + ' · 累计 ' + s.total);
      setKpi('kpi-followup', s.followups_due, s.followups_soon ? s.followups_soon + ' 例 7 天内到期' : '暂无临近复诊');
      setKpi('kpi-anal-total', s.total, '已归档 ' + s.confirmed + ' 例');
      setKpi('kpi-anal-rehab', s.in_rehab, '已审核且需随访');
      setKpi('kpi-anal-done', s.confirmed, '医师审核通过');
    }).catch(function () {});
  }

  function renderReviewTable(rows) {
    var tbody = $('review-tbody');
    if (!tbody) return;
    var pending = rows.filter(function (c) { return c.status === '待审核'; });
    var cnt = $('review-count');
    if (cnt) cnt.textContent = pending.length + ' 例';
    tbody.innerHTML = '';
    pending.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.setAttribute('data-case-no', c.case_no);
      tr.innerHTML =
        '<td>' + escapeHtml(c.case_no) + '</td>' +
        '<td>' + escapeHtml(c.patient_name || '—') + '</td>' +
        '<td>' + escapeHtml(c.part) + '</td>' +
        '<td>' + escapeHtml(firstLine(plainText(c.tech_report), 22)) + '</td>' +
        '<td>' + escapeHtml(c.finding_label || '—') + ' · ' + Math.round((c.confidence || 0) * 100) + '%</td>' +
        '<td>' + fmtTime(c.tech_submitted_at || c.created_at) + '</td>' +
        '<td><span class="badge amber">待审核</span></td>';
      tbody.appendChild(tr);
    });
    if (!pending.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px;">暂无待审核病例</td></tr>';
    }
  }

  function renderArchive(rows) {
    var tbody = $('archive-tbody');
    if (!tbody) return;
    // 患者：本人全部病例；技师：已审核 + 自己待提交/被驳回的；管理员：全部（要管理全流程档案）
    var list = rows.filter(function (c) {
      if (currentRole === '机构管理员') return true;
      if (c.status === '已审核') return true;
      if (currentRole === '影像技师') return c.status === '报告撰写中' || c.status === '已驳回';
      return false;
    });
    var title = $('archive-title');
    if (title && currentRole === '患者') title.textContent = '我的病例与康复档案';
    if (!list.length) {
      var emptyMsg = currentRole === '患者'
        ? '暂无与您账号关联的病例。若病例已建档但未绑定，请点右上角「＋ 绑定我的病例」输入病例号绑定；仍无法解决请联系机构管理员。'
        : '暂无已审核病例';
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:20px;">' + emptyMsg + '</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    list.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(c.case_no) + '</td>' +
        '<td>' + escapeHtml(c.patient_name || '—') +
        (currentRole === '机构管理员' && !c.patient_phone
          ? ' <span class="badge gray">未绑定</span>' : '') + '</td>' +
        '<td>' + escapeHtml(c.part) + ' · ' + escapeHtml(c.modality || '') + '</td>' +
        '<td>' + escapeHtml(c.sport || '—') + '</td>' +
        '<td>' + escapeHtml(c.injury_date || '—') + '</td>' +
        '<td>' + statusBadge(c.status) + '</td>' +
        '<td><button class="btn-line" data-case-no="' + c.case_no + '">' +
        ((currentRole === '影像技师' && c.status !== '已审核') ? '继续写报告' : '查看详情') + '</button></td>';
      tbody.appendChild(tr);
    });
  }

  function renderTodo(rows) {
    var tbody = $('todo-tbody');
    if (!tbody) return;
    var list = rows.filter(function (c) { return c.status === '待审核'; }).slice(0, 5);
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:16px;">暂无待办</td></tr>';
      return;
    }
    list.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.setAttribute('data-open-case', c.case_no);
      tr.innerHTML = '<td>' + escapeHtml(c.case_no) + ' · ' + escapeHtml(c.patient_name || '—') + '</td>' +
        '<td>' + escapeHtml(c.part) + '</td><td>' + Math.round((c.confidence || 0) * 100) + '%</td>' +
        '<td><span class="badge amber">待审核</span></td>';
      tbody.appendChild(tr);
    });
  }

  function fillRehabSelect(rows) {
    var sel = $('rehab-case-select');
    if (!sel) return;
    var list = rows.filter(function (c) { return c.status === '已审核'; });
    var keep = sel.value;
    sel.innerHTML = '<option value="">请选择已审核病例…</option>';
    list.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.case_no;
      o.textContent = c.case_no + ' · ' + (c.patient_name || '—') + ' · ' + c.part;
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
    if (!sel.value && list.length) sel.value = list[0].case_no;
    // 如果当前正停在康复页，填充后立刻载入
    var active = document.querySelector('.view.active');
    if (active && active.id === 'view-rehab' && sel.value) loadRehabCase(sel.value);
  }

  function loadReviewList() {
    API('/api/cases').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok || !d.cases) return;
      casesCache = d.cases;
      renderReviewTable(d.cases);
      renderArchive(d.cases);
      renderTodo(d.cases);
      fillRehabSelect(d.cases);
    }).catch(function () {});
  }

  // 档案页"查看详情" 与 待办行点击
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#view-archive button[data-case-no], #todo-tbody tr[data-open-case]');
    if (!btn) return;
    var caseNo = btn.getAttribute('data-case-no') || btn.getAttribute('data-open-case');
    if (caseNo) openCaseByNo(caseNo);
  });

  loadReviewList();
  loadSummary();
  // 每 60 秒刷新一次队列与总览 KPI（长期开着页面也不会停在旧数据）
  setInterval(function () { loadReviewList(); loadSummary(); }, 60000);

  /* ---------- 病例详情：按角色分块渲染 ---------- */
  var detailFromView = 'archive';
  var currentCase = null;
  var currentFull = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function canRole(roles) { return roles.indexOf(currentRole) >= 0; }
  function isAdmin() { return currentRole === '机构管理员'; }

  function setText(id, text, emptyHint) {
    var el = $(id);
    if (!el) return;
    var v = String(text == null ? '' : text).trim();
    el.textContent = v || (emptyHint || '—');
    el.classList.toggle('is-empty', !v);
  }

  function showEl(id, yes) {
    var el = $(id);
    if (el) el.style.display = yes ? '' : 'none';
  }

  function openCaseByNo(caseNo) {
    if (!caseNo) return;
    var c = casesCache.find(function (x) { return x.case_no === caseNo; });
    showCaseDetail(c || { case_no: caseNo });
  }

  function showCaseDetail(c) {
    if (!c || !c.case_no) { toast('病例信息缺失'); return; }
    var activeView = document.querySelector('.view.active');
    if (activeView) detailFromView = activeView.id.replace('view-', '');

    // AI 助手跟随当前打开的病例，避免回答与病例不匹配
    currentCaseNo = c.case_no;
    setAiCaseLine();

    var backBtn = $('btn-back-review');
    if (backBtn) {
      var backTextMap = { review: '返回待审核队列', archive: '返回病例档案', dashboard: '返回总览', rehab: '返回康复随访' };
      backBtn.textContent = '← ' + (backTextMap[detailFromView] || '返回');
    }

    if (window.__switchView) window.__switchView('case-detail');
    var title = $('case-detail-title');
    if (title) title.textContent = '病例详情 · ' + c.case_no;
    var info = $('detail-case-info');
    if (info) info.innerHTML = '正在加载病例…';
    var fl = $('detail-findings');
    if (fl) fl.innerHTML = '<div class="empty-note" style="text-align:left;">正在加载检测结果…</div>';

    API('/api/cases/' + encodeURIComponent(c.case_no) + '/full')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '加载失败');
        currentCase = d.case;
        currentFull = d;
        renderCaseDetail(d);
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : '网络错误';
        toast('加载病例失败：' + msg);
        if (info) info.innerHTML = '<span style="color:#b91c1c;">加载失败：' + escapeHtml(msg) + '</span>';
      });
  }

  function renderCaseDetail(d) {
    var c = d.case;
    var findings = d.findings || [];
    var pct = Math.round((c.confidence || 0) * 100);
    var token = window.Auth ? Auth.getToken() : '';
    var hasImg = !!c.image_path;
    var url = hasImg ? '/uploads/' + c.image_path + '?token=' + encodeURIComponent(token) : '';

    // 切换病例时退出标注模式，清掉上一例残留的临时框
    if (annotateMode) {
      annotateMode = false;
      annotateRects = [];
      var aLayer = $('annotate-layer');
      if (aLayer) { aLayer.style.display = 'none'; aLayer.innerHTML = ''; }
      var aHint = $('annotate-hint');
      if (aHint) aHint.style.display = 'none';
      var aBtn = $('btn-finish-annotate');
      if (aBtn) aBtn.style.display = 'none';
    }

    setViewerImage('detail-viewer-a', 'detail-original-img', url, hasImg);
    setViewerImage('ai-viewer', 'ai-img', url, hasImg);
    renderBoxes('ai-viewer', 'ai-img', 'detail-box-layer', findings);
    setTimeout(relayoutAllBoxes, 60);
    renderFindingsList($('detail-findings'), findings, {
      model: {
        name: c.model_name || (MODEL_INFO && MODEL_INFO.model_name) || '—',
        version: c.model_ver || (MODEL_INFO && MODEL_INFO.model_version) || '—',
        conf_threshold: (MODEL_INFO && MODEL_INFO.conf_threshold) || '—'
      }
    });

    var badge = $('detail-status-badge');
    if (badge) { badge.className = 'badge ' + (c.status === '已审核' ? 'teal' : (c.status === '已驳回' ? 'red' : 'amber')); badge.textContent = c.status; }

    var info = $('detail-case-info');
    if (info) {
      info.innerHTML =
        '病例号：<b>' + escapeHtml(c.case_no) + '</b><br>' +
        '患者：' + escapeHtml(c.patient_name || '未填写') +
        (c.patient_phone ? '（' + escapeHtml(c.patient_phone) + '）' : '') + '<br>' +
        '部位：' + escapeHtml(c.part) + ' · 影像：' + escapeHtml(c.modality) + '<br>' +
        '运动项目：' + escapeHtml(c.sport || '—') + ' · 受伤日期：' + escapeHtml(c.injury_date || '—') + '<br>' +
        '模型结论：<b>' + escapeHtml(c.finding_label || '—') + '</b>（' + pct + '%）<br>' +
        '检测时间：' + escapeHtml((c.created_at || '—').replace('T', ' ')) + '<br>' +
        '当前状态：<b>' + escapeHtml(c.status) + '</b>';
    }

    renderFlow(d);
    renderReport(d);
    renderAdminCaseBlock(c);
  }

  /* ---------- 管理员：档案信息维护 / 删除 ---------- */
  var adminCaseHintFor = '';
  function renderAdminCaseBlock(c) {
    var block = $('admin-case-block');
    if (!block) return;
    var admin = isAdmin();
    block.style.display = admin ? '' : 'none';
    if (!admin) return;
    var hint = $('admin-case-hint');
    if (hint) hint.textContent = '可修改患者信息与部位；手机号留空即解除绑定；删除会连同影像、随访、检测记录一起移除';
    if ($('ac-name')) $('ac-name').value = c.patient_name || '';
    if ($('ac-phone')) {
      $('ac-phone').value = c.patient_phone || '';
      $('ac-phone').placeholder = '留空=解除绑定，填写需为该患者账号';
    }
    if ($('ac-part')) $('ac-part').value = c.part || '';
    if ($('ac-sport')) $('ac-sport').value = c.sport || '';
    if ($('ac-date')) $('ac-date').value = (c.injury_date || '').slice(0, 10);
    var del = $('btn-ac-delete');
    if (del) { del.setAttribute('data-confirm', '0'); del.textContent = '删除档案'; }
    // 同一病例保存后重渲染时保留"档案已更新"提示，切换病例才清空
    var h = $('ac-hint');
    if (h && adminCaseHintFor !== c.case_no) { h.textContent = ''; adminCaseHintFor = c.case_no; }
  }

  /* ---------- 三段时间线：技师报告 / 医师审核 / 康复随访 ---------- */
  function renderFlow(d) {
    var c = d.case;
    var status = c.status;
    var isDone = status === '已审核';

    // ① 技师报告
    setRich('tech-report-view', c.tech_report, '技师尚未填写检查报告');
    var techMeta = $('flow-tech-meta');
    if (techMeta) {
      techMeta.className = 'badge ' + (c.tech_submitted_at ? 'teal' : 'gray');
      techMeta.textContent = (c.tech_name || '影像技师') + (c.tech_submitted_at ? ' · 提交于 ' + fmtTime(c.tech_submitted_at) : ' · 未提交');
    }
    var canEditTech = canRole(['影像技师', '机构管理员']) && (status === '报告撰写中' || status === '已驳回');
    showEl('tech-report-edit', canEditTech);
    showEl('tech-report-view', !canEditTech);
    var techArea = $('detail-tech-report');
    if (techArea && canEditTech) techArea.value = plainText(c.tech_report || c.ai_report || '');
    if (canEditTech && status === '已驳回' && c.reject_reason) {
      toast('该病例已被驳回：' + c.reject_reason);
    }

    // ② 医师审核
    setRich('doctor-condition-view', c.doctor_report, status === '待审核' ? '等待医师审核' : '—');
    setRich('doctor-advice-view', c.doctor_advice, status === '待审核' ? '等待医师审核' : '—');
    var docMeta = $('flow-doctor-meta');
    if (docMeta) {
      docMeta.className = 'badge ' + (isDone ? 'teal' : (status === '待审核' ? 'amber' : 'gray'));
      docMeta.textContent = isDone
        ? (c.doctor_name || '执业医师') + ' · 审核于 ' + fmtTime(c.reviewed_at)
        : (status === '待审核' ? '待医师审核' : '未进入审核');
    }
    var canReview = canRole(['执业医师', '机构管理员']) && status === '待审核';
    showEl('doctor-edit', canReview);
    showEl('doctor-readonly', !canReview);
    if (canReview) {
      var condEl = $('doctor-condition');
      var advEl = $('doctor-advice');
      // 每次渲染都以当前病例为准，避免带上上一例的文字
      if (condEl) condEl.value = plainText(c.doctor_report || '');
      if (advEl) advEl.value = plainText(c.doctor_advice || '');
    }

    // ③ 康复
    setRich('rehab-view', c.rehab_advice, isDone ? '康复治疗师尚未补充康复方案' : '医师审核通过后可补充康复建议');
    var rehabMeta = $('flow-rehab-meta');
    if (rehabMeta) {
      rehabMeta.className = 'badge ' + (c.rehab_updated_at ? 'teal' : 'gray');
      rehabMeta.textContent = c.rehab_updated_at
        ? (c.rehab_name || '康复治疗师') + ' · 更新于 ' + fmtTime(c.rehab_updated_at)
        : '暂无康复建议';
    }
    var canRehab = canRole(['康复治疗师', '机构管理员']) && isDone;
    showEl('rehab-edit', canRehab);
    var rehabArea = $('rehab-text');
    if (rehabArea && canRehab) rehabArea.value = plainText(c.rehab_advice || '');

    // 随访
    renderFollowupTable($('fu-tbody'), d.followups || []);
    showEl('fu-form', canRehab);
    var fuDate = $('fu-date');
    if (fuDate && !fuDate.value) {
      var t = new Date();
      fuDate.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }

    // 管理员撤回
    var reopenBtn = $('btn-reopen-review');
    if (reopenBtn) {
      reopenBtn.style.display = (isAdmin() && isDone) ? '' : 'none';
      reopenBtn.setAttribute('data-case-no', c.case_no);
    }
  }

  function renderFollowupTable(tbody, followups) {
    if (!tbody) return;
    if (!followups.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:14px;">暂无随访记录</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    followups.slice().reverse().forEach(function (f) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(f.record_date) + '</td>' +
        '<td>' + (f.pain_score != null ? f.pain_score + '/10' : '—') + '</td>' +
        '<td>' + (f.rom != null ? f.rom + '%' : '—') + '</td>' +
        '<td>' + escapeHtml(f.swelling || '—') + '</td>' +
        '<td>' + escapeHtml(f.training || '—') + '</td>' +
        '<td>' + escapeHtml(f.note || '—') + '</td>' +
        '<td>' + escapeHtml(f.author || '—') + '</td>';
      tbody.appendChild(tr);
    });
  }

  function trendText(followups) {
    if (!followups || !followups.length) return '暂无随访数据，录入 2 次以上评估即可对比康复趋势。';
    var first = followups[0], last = followups[followups.length - 1];
    var dPain = (last.pain_score || 0) - (first.pain_score || 0);
    var dRom = (last.rom || 0) - (first.rom || 0);
    var trend = (dPain < 0 || dRom > 0) ? '整体向好' : (dPain > 0 ? '疼痛回升，需复评' : '变化不明显');
    return '共 ' + followups.length + ' 次随访：疼痛 ' + (first.pain_score || 0) + ' → ' + (last.pain_score || 0) +
      '/10，活动度 ' + (first.rom || 0) + '% → ' + (last.rom || 0) + '%，判断：<b>' + trend + '</b>。';
  }

  function renderReport(d) {
    var c = d.case;
    var med = $('rpt-medical');
    var report = d.report;
    var content = $('case-report-content');
    var btn = $('btn-toggle-report');

    if (med) {
      if (report) {
        med.innerHTML = '<h4>' + escapeHtml(report.title || '审核报告') + '</h4>' +
          '<h5>一、病情情况</h5><div class="rpt-body">' + mdToHtml(report.summary || '—') + '</div>' +
          '<h5>二、治疗建议</h5><div class="rpt-body">' + mdToHtml(report.conclusion || '—') + '</div>' +
          (c.rehab_advice ? '<h5>三、康复方案（康复治疗师）</h5><div class="rpt-body">' + mdToHtml(c.rehab_advice) + '</div>' : '') +
          '<h5>四、检测依据</h5><p>检测模型：' + escapeHtml(report.model || c.model_name || '—') +
          '；模型结论：' + escapeHtml(c.finding_label || '—') + '（' + Math.round((c.confidence || 0) * 100) + '%）。</p>' +
          '<div class="report-foot">状态：<b>已审核</b> · 审核医师 ' + escapeHtml(report.doctor || '—') +
          ' · ' + escapeHtml((report.reviewed_at || '').replace('T', ' ')) + '</div>';
      } else {
        med.innerHTML = '<p style="color:var(--text-secondary);">该病例尚未通过医师审核，暂无审核报告。</p>';
      }
    }
    if (content && btn) {
      var autoOpen = !!report;
      content.style.display = autoOpen ? 'block' : 'none';
      btn.textContent = autoOpen ? '收起报告' : '展开报告';
    }
  }
  window.__showCaseDetail = showCaseDetail;

  // 返回按钮：回到来源视图
  var btnBack = $('btn-back-review');
  if (btnBack) btnBack.addEventListener('click', function () {
    if (window.__switchView) window.__switchView(detailFromView);
  });

  // 加载报告页数据
  // 报告页展开/收起按钮
  var btnToggleReport = $('btn-toggle-report');
  if (btnToggleReport) btnToggleReport.addEventListener('click', function () {
    var content = $('case-report-content');
    if (content) {
      var show = content.style.display === 'none';
      content.style.display = show ? 'block' : 'none';
      btnToggleReport.textContent = show ? '收起报告' : '展开报告';
    }
  });

  // 管理员撤回：把已审核的病例打回待审核
  var btnReopen = $('btn-reopen-review');
  if (btnReopen) btnReopen.addEventListener('click', function () {
    var caseNo = btnReopen.getAttribute('data-case-no');
    if (!caseNo) return;
    if (!confirm('确认将该病例撤回，重新进入待审核队列？')) return;
    API('/api/cases/' + caseNo + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reopen', note: '管理员撤回重审' })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        toast('已撤回，重新进入待审核');
        loadReviewList();
        reloadDetail(caseNo);
      } else {
        toast(d.error || '操作失败');
      }
    }).catch(function () { toast('操作失败'); });
  });

  function reloadDetail(caseNo) {
    API('/api/cases/' + encodeURIComponent(caseNo) + '/full').then(function (r) { return r.json(); }).then(function (dd) {
      if (!dd.ok) return;
      currentCase = dd.case;
      currentFull = dd;
      renderCaseDetail(dd);
    }).catch(function () {});
  }

  // 审核动作：confirm（通过归档）/ reject（驳回）/ annotate（补充人工标注）
  var annotateMode = false;
  var annotateRects = [];
  var drawingRect = null;
  var startX = 0, startY = 0;

  function doReview(action) {
    var caseNo = currentCase ? currentCase.case_no : '';
    if (!caseNo) return;

    if (action === 'annotate') {
      annotateMode = true;
      annotateRects = [];
      var layer = $('annotate-layer');
      var hint = $('annotate-hint');
      var finishBtn = $('btn-finish-annotate');
      if (layer) { layer.style.display = 'block'; layer.innerHTML = ''; }
      if (hint) hint.style.display = 'inline';
      if (finishBtn) finishBtn.style.display = 'inline-block';
      toast('标注模式：在图上拖拽鼠标画矩形框，标出正确的损伤位置');
      return;
    }

    var payload = { action: action };
    if (action === 'confirm') {
      var cond = ($('doctor-condition') || {}).value || '';
      var adv = ($('doctor-advice') || {}).value || '';
      if (!cond.trim() || !adv.trim()) { toast('通过前请先填写病情情况和治疗建议'); return; }
      payload.condition = cond.trim();
      payload.advice = adv.trim();
      payload.note = '医师审核通过';
    } else if (action === 'reject') {
      var reason = prompt('请填写驳回原因（影像技师会看到）', '技师报告与影像不符，请补充侧位片');
      if (!reason) return;
      payload.note = reason;
    }

    API('/api/cases/' + caseNo + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { toast(d.error || '操作失败'); return; }
      toast(action === 'confirm' ? '已审核通过，病例进入康复档案' : (action === 'reject' ? '已驳回给影像技师' : '已提交'));
      loadReviewList();
      loadSummary();
      reloadDetail(caseNo);
      if (action !== 'annotate' && window.__switchView) window.__switchView(detailFromView);
    }).catch(function () { toast('网络错误'); });
  }

  /* ---------- 技师报告（详情页） ---------- */
  function detailTechReport(submit) {
    var caseNo = currentCase ? currentCase.case_no : '';
    if (!caseNo) return;
    var area = $('detail-tech-report');
    var content = area ? area.value.trim() : '';
    if (submit && !content) { toast('提交前请先填写检查报告'); return; }
    API('/api/cases/' + caseNo + '/tech-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content, submit: !!submit })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { toast(d.error || '保存失败'); return; }
      toast(submit ? '已提交医师审核' : '草稿已保存');
      loadReviewList();
      loadSummary();
      reloadDetail(caseNo);
    }).catch(function () { toast('网络错误'); });
  }
  var dTechSave = $('btn-detail-tech-save');
  if (dTechSave) dTechSave.addEventListener('click', function () { detailTechReport(false); });
  var dTechSubmit = $('btn-detail-tech-submit');
  if (dTechSubmit) dTechSubmit.addEventListener('click', function () { detailTechReport(true); });

  /* ---------- 医师 AI 辅助 ---------- */
  var aiReviewBtn = $('btn-ai-review');
  if (aiReviewBtn) aiReviewBtn.addEventListener('click', function () {
    var caseNo = currentCase ? currentCase.case_no : '';
    if (!caseNo) return;
    aiReviewBtn.disabled = true;
    var hint = $('ai-review-hint');
    if (hint) hint.textContent = '正在请求 AI 分析…';
    API('/api/cases/' + caseNo + '/ai-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { toast(d.error || 'AI 分析失败'); return; }
        var s = d.suggestion || {};
        var condEl = $('doctor-condition');
        var advEl = $('doctor-advice');
        if (condEl) condEl.value = plainText(s.condition) || condEl.value;
        if (advEl) advEl.value = plainText(s.advice) || advEl.value;
        if (hint) hint.textContent = d.ai_used ? 'AI 初稿已填入，请核对后修改' : 'AI 不可用，已用本地模板填入';
        toast('AI 初稿已生成，请核对后再审核');
      })
      .catch(function () { toast('AI 分析失败'); if (hint) hint.textContent = ''; })
      .then(function () { aiReviewBtn.disabled = false; });
  });

  /* ---------- 康复建议（详情页） ---------- */
  var rehabSaveBtn = $('btn-rehab-save');
  if (rehabSaveBtn) rehabSaveBtn.addEventListener('click', function () {
    var caseNo = currentCase ? currentCase.case_no : '';
    var area = $('rehab-text');
    var content = area ? area.value.trim() : '';
    if (!caseNo || !content) { toast('请先填写康复建议'); return; }
    API('/api/cases/' + caseNo + '/rehab-advice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { toast(d.error || '保存失败'); return; }
      toast('已写入康复档案');
      reloadDetail(caseNo);
    }).catch(function () { toast('网络错误'); });
  });

  var aiRehabBtn = $('btn-ai-rehab');
  if (aiRehabBtn) aiRehabBtn.addEventListener('click', function () {
    var caseNo = currentCase ? currentCase.case_no : '';
    if (!caseNo) return;
    aiRehabBtn.disabled = true;
    var hint = $('ai-rehab-hint');
    if (hint) hint.textContent = '正在请求 AI 生成…';
    API('/api/cases/' + caseNo + '/ai-rehab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { toast(d.error || 'AI 生成失败'); return; }
        var s = d.suggestion || {};
        var area = $('rehab-text');
        if (area) area.value = plainText(s.advice || '') + (s.progress ? '\n\n【恢复情况】\n' + plainText(s.progress) : '');
        if (hint) hint.textContent = d.ai_used ? 'AI 初稿已填入，请核对后保存' : 'AI 不可用，已用本地模板填入';
        toast('AI 康复建议已生成');
      })
      .catch(function () { toast('AI 生成失败'); if (hint) hint.textContent = ''; })
      .then(function () { aiRehabBtn.disabled = false; });
  });

  /* ---------- 随访录入（详情页） ---------- */
  function collectFollowup(p) {
    var val = function (id) { var el = $(id); return el ? el.value : ''; };
    return {
      record_date: val(p + 'date'),
      pain_score: val(p + 'pain'),
      rom: val(p + 'rom'),
      swelling: val(p + 'swell'),
      training: val(p + 'training'),
      note: val(p + 'note')
    };
  }

  function addFollowup(caseNo, body, after) {
    API('/api/cases/' + caseNo + '/followups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { toast(d.error || '录入失败'); return; }
      toast('随访记录已保存');
      after();
    }).catch(function () { toast('网络错误'); });
  }

  var fuAdd = $('btn-fu-add');
  if (fuAdd) fuAdd.addEventListener('click', function () {
    var caseNo = currentCase ? currentCase.case_no : '';
    if (!caseNo) return;
    addFollowup(caseNo, collectFollowup('fu-'), function () { reloadDetail(caseNo); });
  });

  /* ---------- 康复与随访页（独立视图） ---------- */
  var rehabCaseNo = '';
  function loadRehabCase(caseNo) {
    if (!caseNo) return;
    rehabCaseNo = caseNo;
    currentCaseNo = caseNo;
    setAiCaseLine();
    API('/api/cases/' + encodeURIComponent(caseNo) + '/full').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { toast(d.error || '加载失败'); return; }
      var c = d.case;
      var kv1 = document.querySelectorAll('#rehab-patient-kv dd');
      var kv2 = document.querySelectorAll('#rehab-doctor-kv dd');
      if (kv1.length >= 6) {
        kv1[0].textContent = c.case_no;
        kv1[1].textContent = (c.patient_name || '—') + (c.patient_phone ? '（' + c.patient_phone + '）' : '');
        kv1[2].textContent = c.part + ' · ' + (c.modality || '');
        kv1[3].textContent = c.sport || '—';
        kv1[4].textContent = c.injury_date || '—';
        kv1[5].textContent = c.stage || '—';
      }
      if (kv2.length >= 6) {
        kv2[0].innerHTML = c.doctor_report ? mdToHtml(c.doctor_report) : '—';
        kv2[1].innerHTML = c.doctor_advice ? mdToHtml(c.doctor_advice) : '—';
        kv2[2].textContent = (c.finding_label || '—') + '（' + Math.round((c.confidence || 0) * 100) + '%）';
        kv2[3].textContent = c.doctor_name || '—';
        kv2[4].textContent = (c.reviewed_at || '—').replace('T', ' ');
        var fus = d.followups || [];
        kv2[5].textContent = fus.length ? fus[fus.length - 1].record_date + ' · 疼痛 ' + fus[fus.length - 1].pain_score + '/10' : '暂无';
      }
      var editor = $('rehab-editor');
      if (editor) editor.value = plainText(c.rehab_advice || '');
      renderFollowupTable($('rehab-fu-tbody'), d.followups || []);
      var trend = $('rehab-trend');
      if (trend) trend.innerHTML = trendText(d.followups || []);
      var aiHint = $('rehab-ai-hint');
      if (aiHint) aiHint.textContent = '';
    }).catch(function () { toast('加载失败'); });
  }

  var rehabLoadBtn = $('rehab-load-btn');
  if (rehabLoadBtn) rehabLoadBtn.addEventListener('click', function () {
    var sel = $('rehab-case-select');
    if (sel && sel.value) loadRehabCase(sel.value);
    else toast('请先选择病例');
  });
  var rehabSelect = $('rehab-case-select');
  if (rehabSelect) rehabSelect.addEventListener('change', function () {
    if (rehabSelect.value) loadRehabCase(rehabSelect.value);
  });

  var rehabAiBtn = $('rehab-ai-btn');
  if (rehabAiBtn) rehabAiBtn.addEventListener('click', function () {
    if (!rehabCaseNo) { toast('请先选择病例'); return; }
    rehabAiBtn.disabled = true;
    var hint = $('rehab-ai-hint');
    if (hint) hint.textContent = '正在请求 AI 生成…';
    API('/api/cases/' + rehabCaseNo + '/ai-rehab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { toast(d.error || 'AI 生成失败'); return; }
        var s = d.suggestion || {};
        var editor = $('rehab-editor');
        if (editor) editor.value = plainText(s.advice || '') + (s.progress ? '\n\n【恢复情况】\n' + plainText(s.progress) : '');
        if (hint) hint.textContent = d.ai_used ? 'AI 初稿已填入，请核对后保存' : 'AI 不可用，已用本地模板填入';
        toast('AI 康复建议已生成');
      }).catch(function () { toast('AI 生成失败'); })
      .then(function () { rehabAiBtn.disabled = false; });
  });

  var rehabSave = $('rehab-save-btn');
  if (rehabSave) rehabSave.addEventListener('click', function () {
    if (!rehabCaseNo) { toast('请先选择病例'); return; }
    var editor = $('rehab-editor');
    var content = editor ? editor.value.trim() : '';
    if (!content) { toast('康复建议不能为空'); return; }
    API('/api/cases/' + rehabCaseNo + '/rehab-advice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { toast(d.error || '保存失败'); return; }
      toast('已写入康复档案');
      loadRehabCase(rehabCaseNo);
    }).catch(function () { toast('网络错误'); });
  });

  var rehabToggleFu = $('rehab-toggle-fu');
  if (rehabToggleFu) rehabToggleFu.addEventListener('click', function () {
    var form = $('rehab-fu-form');
    if (!form) return;
    var show = form.style.display === 'none';
    form.style.display = show ? 'block' : 'none';
    if (show) {
      var dEl = $('fu2-date');
      if (dEl && !dEl.value) {
        var t = new Date();
        dEl.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      }
    }
  });
  var rehabFuAdd = $('rehab-fu-add');
  if (rehabFuAdd) rehabFuAdd.addEventListener('click', function () {
    if (!rehabCaseNo) { toast('请先选择病例'); return; }
    addFollowup(rehabCaseNo, collectFollowup('fu2-'), function () { loadRehabCase(rehabCaseNo); });
  });

  // 完成标注：把拖出的框换算成"原图归一化坐标"后提交
  function annotationsFromRects() {
    var viewer = $('ai-viewer'), img = $('ai-img');
    if (!viewer || !img || !annotateRects.length) return [];
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return [];
    var vw = viewer.clientWidth, vh = viewer.clientHeight;
    var scale = Math.min(vw / iw, vh / ih);
    var dw = iw * scale, dh = ih * scale;
    var ox = (vw - dw) / 2, oy = (vh - dh) / 2;
    var clamp = function (v) { return Math.min(1, Math.max(0, v)); };
    return annotateRects.map(function (r) {
      return {
        bbox: [
          clamp((r.x - ox) / dw), clamp((r.y - oy) / dh),
          clamp((r.x + r.w - ox) / dw), clamp((r.y + r.h - oy) / dh),
        ],
      };
    }).filter(function (a) {
      return a.bbox[2] - a.bbox[0] > 0.005 && a.bbox[3] - a.bbox[1] > 0.005;
    });
  }

  var finishBtn = $('btn-finish-annotate');
  if (finishBtn) finishBtn.addEventListener('click', function () {
    annotateMode = false;
    var layer = $('annotate-layer');
    var hint = $('annotate-hint');
    if (layer) layer.style.display = 'none';
    if (hint) hint.style.display = 'none';
    finishBtn.style.display = 'none';
    var caseNo = currentCase ? currentCase.case_no : '';
    var anns = annotationsFromRects();
    API('/api/cases/' + caseNo + '/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'annotate', note: '人工标注 ' + anns.length + ' 处', annotations: anns })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        toast('已提交人工标注 ' + (d.annotations_saved || 0) + ' 处');
        loadReviewList();
        reloadDetail(caseNo);
      } else {
        toast(d.error || '保存失败');
      }
    }).catch(function () { toast('网络错误'); });
  });

  // 标注模式：鼠标拖动画矩形框
  document.addEventListener('mousedown', function (e) {
    if (!annotateMode) return;
    var layer = $('annotate-layer');
    if (!layer) return;
    if (!layer.contains(e.target) && e.target.id !== 'annotate-layer') return;
    var rect = layer.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    var pctX = (startX / rect.width * 100).toFixed(1);
    var pctY = (startY / rect.height * 100).toFixed(1);
    drawingRect = document.createElement('div');
    drawingRect.style.cssText = 'position:absolute;left:' + pctX + '%;top:' + pctY + '%;width:0;height:0;border:2px solid #dc2626;pointer-events:none;';
    layer.appendChild(drawingRect);
  });

  document.addEventListener('mousemove', function (e) {
    if (!annotateMode || !drawingRect) return;
    var layer = $('annotate-layer');
    if (!layer) return;
    var rect = layer.getBoundingClientRect();
    var currentX = e.clientX - rect.left;
    var currentY = e.clientY - rect.top;
    var left = Math.min(startX, currentX);
    var top = Math.min(startY, currentY);
    var width = Math.abs(currentX - startX);
    var height = Math.abs(currentY - startY);
    drawingRect.style.left = (left / rect.width * 100).toFixed(1) + '%';
    drawingRect.style.top = (top / rect.height * 100).toFixed(1) + '%';
    drawingRect.style.width = (width / rect.width * 100).toFixed(1) + '%';
    drawingRect.style.height = (height / rect.height * 100).toFixed(1) + '%';
  });

  document.addEventListener('mouseup', function (e) {
    if (!annotateMode || !drawingRect) return;
    var layer = $('annotate-layer');
    if (!layer) return;
    var rect = layer.getBoundingClientRect();
    var currentX = e.clientX - rect.left;
    var currentY = e.clientY - rect.top;
    var width = Math.abs(currentX - startX);
    var height = Math.abs(currentY - startY);
    if (width < 10 || height < 10) {
      if (drawingRect.parentNode) drawingRect.parentNode.removeChild(drawingRect);
    } else {
      annotateRects.push({ x: startX, y: startY, w: width, h: height });
    }
    drawingRect = null;
  });

  // 审核动作按钮（由状态 + 角色控制显示）
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#doctor-edit .review-btn[data-action]');
    if (!btn) return;
    doReview(btn.getAttribute('data-action'));
  }, true);

  /* ---------- AI 聊天：接百炼后端（已在上面 sendAI 中实现） ---------- */

  /* ---------- 统计图表：全部来自后端真实统计 ---------- */
  var charts = {};
  function upsertChart(id, option) {
    var el = $(id);
    if (!el || typeof echarts === 'undefined') return;
    // 隐藏视图里的容器高度为 0，等切过去时再渲染，避免 ECharts 报警
    if (!el.clientHeight) return;
    if (charts[id]) charts[id].dispose();
    charts[id] = echarts.init(el);
    charts[id].setOption(option);
  }

  function lineOption(xAxis, series, color) {
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 44, right: 20, top: 30, bottom: 30 },
      xAxis: { type: 'category', data: xAxis, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f7' } } },
      series: [{
        type: 'line', smooth: true, data: series, symbolSize: 6,
        lineStyle: { width: 3, color: color || '#2563eb' }, itemStyle: { color: color || '#2563eb' },
        areaStyle: { opacity: .12 }
      }]
    };
  }

  function loadCharts() {
    var get = function (topic, cb) {
      API('/api/stats/' + topic).then(function (r) { return r.json(); })
        .then(function (d) { if (d.ok) cb(d.data || {}); }).catch(function () {});
    };

    get('weekly', function (data) {
      upsertChart('chart-weekly', {
        tooltip: { trigger: 'axis' },
        grid: { left: 36, right: 16, top: 28, bottom: 28 },
        xAxis: { type: 'category', data: data.xAxis || [], axisTick: { show: false } },
        yAxis: { type: 'value', splitLine: { lineStyle: { color: '#eef2f7' } } },
        series: [{
          type: 'bar', barWidth: '46%', data: data.series || [],
          itemStyle: { color: '#2563eb', borderRadius: [5, 5, 0, 0] },
          label: { show: true, position: 'top', color: '#64748b', fontSize: 11 }
        }]
      });
    });

    get('monthly', function (data) {
      upsertChart('chart-monthly', lineOption(data.xAxis || [], data.series || [], '#2563eb'));
    });

    get('followups', function (data) {
      upsertChart('chart-accuracy', {
        tooltip: { trigger: 'axis' },
        grid: { left: 40, right: 18, top: 28, bottom: 30 },
        xAxis: { type: 'category', data: data.xAxis || [], axisTick: { show: false } },
        yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#eef2f7' } } },
        series: [{
          name: '随访记录', type: 'bar', barWidth: '50%', data: data.series || [],
          itemStyle: { color: '#0ea5a0', borderRadius: [5, 5, 0, 0] }
        }]
      });
    });

    get('body', function (data) {
      upsertChart('chart-body', {
        tooltip: { trigger: 'item', formatter: '{b}：{c} 例（{d}%）' },
        legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12 } },
        color: ['#2563eb', '#0ea5a0', '#8b5cf6', '#f59e0b', '#94a3b8'],
        series: [{
          type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          label: { show: false }, labelLine: { show: false },
          data: data || []
        }]
      });
    });

    get('stage', function (data) {
      upsertChart('chart-rehab-duration', {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 40, right: 18, top: 28, bottom: 30 },
        xAxis: { type: 'category', data: data.xAxis || [], axisTick: { show: false } },
        yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#eef2f7' } } },
        series: [{
          type: 'bar', barWidth: '48%', data: data.series || [],
          itemStyle: { color: '#f59e0b', borderRadius: [5, 5, 0, 0] }
        }]
      });
    });

    get('cross', function (data) {
      upsertChart('chart-cross', {
        tooltip: { position: 'top' },
        grid: { left: 72, right: 18, top: 16, bottom: 70 },
        xAxis: { type: 'category', data: data.sports || [], splitArea: { show: true } },
        yAxis: { type: 'category', data: data.parts || [], splitArea: { show: true } },
        visualMap: {
          min: 0, max: Math.max(5, Math.max.apply(null, (data.cells || [[0, 0, 0]]).map(function (c) { return c[2]; }))),
          calculable: true, orient: 'horizontal', left: 'center', bottom: 8,
          inRange: { color: ['#eff6ff', '#93c5fd', '#2563eb', '#1e3a8a'] }, textStyle: { fontSize: 11 }
        },
        series: [{
          type: 'heatmap', data: data.cells || [],
          label: { show: true, fontSize: 11 },
          itemStyle: { borderColor: '#fff', borderWidth: 2 }
        }]
      });
    });
  }
  window.addEventListener('resize', function () {
    Object.keys(charts).forEach(function (k) { if (charts[k]) charts[k].resize(); });
  });

  /* ============================================================
   * 运动回归：阶梯与恢复度全部按该病例随访记录计算
   * ============================================================ */
  function renderRecoveryEmpty() {
    var box = $('return-ladder');
    if (box) box.innerHTML = '<div class="empty-note">请选择病例后查看回归阶梯</div>';
    var lab = $('return-case-label');
    if (lab) lab.textContent = '（未选择病例）';
    var badge = $('return-stage-badge');
    if (badge) badge.textContent = '—';
    var note = $('return-score-note');
    if (note) note.textContent = '暂无随访记录，无法计算恢复度。';
  }

  function loadRecovery(caseNo) {
    API('/api/cases/' + encodeURIComponent(caseNo) + '/recovery')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '加载失败');
        var lab = $('return-case-label');
        if (lab) lab.textContent = '· ' + d.case_no + '（' + (d.part || '—') + '）';

        var cur = null;
        (d.ladder || []).forEach(function (s) { if (s.state === 'current') cur = s; });
        if (!cur && d.ladder && d.ladder.length) cur = d.ladder[d.ladder.length - 1];
        var badge = $('return-stage-badge');
        if (badge) badge.textContent = '当前：' + (cur ? cur.name : '—') + ' · 恢复度 ' + d.score + '%';

        var box = $('return-ladder');
        if (box) {
          box.innerHTML = '';
          (d.ladder || []).forEach(function (s) {
            var el = document.createElement('div');
            el.className = 'ret-step' + (s.state === 'done' ? ' done' : (s.state === 'current' ? ' current' : ''));
            el.innerHTML = '<div class="r-name">' + escapeHtml(s.name) + '</div>' +
              '<div class="r-flag">' + (s.state === 'done' ? '已通过' : (s.state === 'current' ? '当前阶段' : '待评估')) + '</div>';
            box.appendChild(el);
          });
        }

        var note = $('return-score-note');
        if (note) {
          note.textContent = d.followups
            ? ('依据 ' + d.followups + ' 条随访记录计算：当前恢复度 ' + d.score + '%，回归达标线 ' + d.target + '%。')
            : '该病例暂无随访记录，无法计算恢复度，阶梯保持待评估。';
        }

        if (typeof echarts !== 'undefined') {
          var el = $('chart-recovery');
          if (el) {
            var chart = echarts.getInstanceByDom(el) || echarts.init(el);
            chart.setOption({
              grid: { left: 42, right: 20, top: 26, bottom: 30 },
              tooltip: { trigger: 'axis', valueFormatter: function (v) { return v + ' 分'; } },
              xAxis: { type: 'category', boundaryGap: false, data: (d.series || []).map(function (p) { return p.date.slice(5); }) },
              yAxis: { type: 'value', min: 0, max: 100, name: '分', splitLine: { lineStyle: { color: '#eef2f7' } } },
              series: [{
                name: '恢复度', type: 'line', smooth: true,
                data: (d.series || []).map(function (p) { return p.score; }),
                symbolSize: 8, lineStyle: { width: 3, color: '#0ea5a0' }, itemStyle: { color: '#0ea5a0' },
                areaStyle: { color: 'rgba(14,165,160,.18)' },
                markLine: {
                  symbol: 'none', lineStyle: { color: '#ef4444', type: 'dashed' },
                  data: [{ yAxis: d.target, label: { formatter: '回归达标 ' + d.target + ' 分', color: '#ef4444', position: 'insideEndTop' } }]
                }
              }]
            }, true);
          }
        }
      })
      .catch(function (e) { toast('回归阶梯加载失败：' + e.message); });
  }

  function loadReturnView() {
    var sel = $('return-case-select');
    if (!sel) return;
    var list = casesCache.filter(function (c) { return c.status === '已审核'; });
    var keep = sel.value;
    sel.innerHTML = '<option value="">请选择已审核病例…</option>';
    list.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.case_no;
      o.textContent = c.case_no + ' · ' + (c.patient_name || '—') + ' · ' + c.part;
      sel.appendChild(o);
    });
    var hasKeep = keep && list.some(function (c) { return c.case_no === keep; });
    sel.value = hasKeep ? keep : (list.length ? list[0].case_no : '');
    if (sel.value) loadRecovery(sel.value); else renderRecoveryEmpty();
  }

  var returnSel = $('return-case-select');
  if (returnSel) returnSel.addEventListener('change', function () {
    if (returnSel.value) loadRecovery(returnSel.value); else renderRecoveryEmpty();
  });
  var returnBtn = $('return-load-btn');
  if (returnBtn) returnBtn.addEventListener('click', function () {
    if (returnSel && returnSel.value) loadRecovery(returnSel.value); else toast('请先选择病例');
  });

  /* ============================================================
   * 患者：自助绑定病例（建档时没填手机号的场景）
   * ============================================================ */
  var bindToggle = $('btn-bind-toggle');
  if (bindToggle && currentRole === '患者') {
    bindToggle.hidden = false;
    bindToggle.addEventListener('click', function () {
      var p = $('panel-patient-bind');
      if (!p) return;
      p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
    });
  }
  var bindBtn = $('bind-case-btn');
  if (bindBtn) bindBtn.addEventListener('click', function () {
    var inp = $('bind-case-no');
    var hint = $('bind-hint');
    var no = inp ? inp.value.trim() : '';
    if (!no) { toast('请输入病例号'); return; }
    bindBtn.disabled = true;
    if (hint) hint.textContent = '';
    API('/api/patient/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_no: no })
    }).then(function (r) { return r.json(); }).then(function (d) {
      bindBtn.disabled = false;
      if (!d.ok) {
        if (hint) hint.textContent = d.error || '绑定失败';
        toast(d.error || '绑定失败');
        return;
      }
      if (hint) {
        hint.textContent = (d.binding && d.binding.status && d.binding.status !== '已审核')
          ? '已绑定该病例，医师审核通过后可在档案中查看'
          : '绑定成功，档案已刷新';
      }
      toast(d.already ? '该病例已在您的档案中' : '绑定成功');
      if (inp) inp.value = '';
      loadReviewList();
    }).catch(function () { bindBtn.disabled = false; toast('网络错误：请确认后端已启动'); });
  });

  /* ============================================================
   * 机构管理员：真实账号表 + 病例绑定
   * ============================================================ */
  function roleBadge(role) {
    var map = { '执业医师': 'blue', '影像技师': 'amber', '康复治疗师': 'teal', '机构管理员': 'red', '患者': 'gray' };
    return map[role] || 'gray';
  }

  var usersCache = [];
  var editingUserId = null;

  function loadUsersTable() {
    var tb = $('users-tbody');
    if (!tb) return;
    API('/api/admin/users').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) {
        tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#b91c1c;padding:16px;">' +
          escapeHtml(d.error || '加载失败') + '</td></tr>';
        return;
      }
      usersCache = d.users || [];
      tb.innerHTML = '';
      if (!usersCache.length) {
        tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:16px;">暂无账号</td></tr>';
        return;
      }
      usersCache.forEach(function (u) {
        var tr = document.createElement('tr');
        var me = (window.Auth && Auth.getUser()) ? Auth.getUser().username : '';
        var self = me && me === u.phone;
        tr.innerHTML =
          '<td>' + escapeHtml(u.name) + (self ? ' <span class="badge blue">本人</span>' : '') + '</td>' +
          '<td><span class="badge ' + roleBadge(u.role) + '">' + escapeHtml(u.role) + '</span></td>' +
          '<td>' + escapeHtml(u.phone || '—') + '</td>' +
          '<td>' + escapeHtml(u.org || '—') + '</td>' +
          '<td>' + (u.role === '患者' ? (u.case_count || 0) : '—') + '</td>' +
          '<td><span class="badge ' + (u.status === 'active' ? 'teal' : 'gray') + '">' +
          (u.status === 'active' ? '启用' : '停用') + '</span></td>' +
          '<td>' + escapeHtml((u.created_at || '').slice(0, 10)) + '</td>' +
          '<td><div style="display:flex; gap:6px; flex-wrap:wrap;">' +
          '<button class="btn-line" type="button" data-edit-user="' + u.id + '">编辑</button>' +
          '<button class="btn-line" type="button" data-del-user="' + u.id + '" data-confirm="0" ' +
          'style="color:#b91c1c;">删除</button></div></td>';
        tb.appendChild(tr);
      });
    }).catch(function () {
      tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#b91c1c;padding:16px;">账号表加载失败，请确认后端已启动</td></tr>';
    });
  }

  /* ---------- 账号：新增 / 编辑 / 删除 ---------- */
  function openUserForm(u) {
    var panel = $('panel-user-form');
    if (!panel) return;
    editingUserId = u ? u.id : null;
    if ($('uf-title')) $('uf-title').textContent = u ? ('编辑账号 · ' + u.name) : '新增账号';
    if ($('uf-sub')) $('uf-sub').textContent = u
      ? '手机号即登录账号；修改手机号会同步迁移该患者已绑定的病例'
      : '手机号即登录账号，开通后可立即登录';
    if ($('uf-name')) $('uf-name').value = u ? (u.name || '') : '';
    if ($('uf-phone')) $('uf-phone').value = u ? (u.phone || '') : '';
    if ($('uf-role')) $('uf-role').value = u ? u.role : '影像技师';
    if ($('uf-org')) $('uf-org').value = u ? (u.org || '') : '';
    if ($('uf-status')) $('uf-status').value = u ? (u.status || 'active') : 'active';
    if ($('uf-password')) { $('uf-password').value = ''; $('uf-password').placeholder = u ? '留空表示不修改密码' : '初始密码 ≥6 位'; }
    if ($('uf-hint')) $('uf-hint').textContent = '';
    panel.style.display = '';
    var first = $('uf-name');
    if (first) first.focus();
  }

  function closeUserForm() {
    var panel = $('panel-user-form');
    if (panel) panel.style.display = 'none';
    editingUserId = null;
  }

  function userFormPayload() {
    var pwd = ($('uf-password') && $('uf-password').value) || '';
    var body = {
      name: ($('uf-name') && $('uf-name').value || '').trim(),
      phone: ($('uf-phone') && $('uf-phone').value || '').trim(),
      role: ($('uf-role') && $('uf-role').value) || '',
      org: ($('uf-org') && $('uf-org').value || '').trim(),
      status: ($('uf-status') && $('uf-status').value) || 'active'
    };
    if (pwd) body.password = pwd;
    return body;
  }

  function saveUserForm() {
    var body = userFormPayload();
    var hint = $('uf-hint');
    var btn = $('btn-uf-save');
    if (!body.name) { if (hint) hint.textContent = '请填写姓名'; return; }
    if (!/^1[3-9]\d{9}$/.test(body.phone)) { if (hint) hint.textContent = '手机号格式不正确（11 位，1 开头）'; return; }
    if (!editingUserId && !body.password) { if (hint) hint.textContent = '新增账号必须设置初始密码'; return; }
    if (btn) btn.disabled = true;
    var url = editingUserId ? '/api/admin/users/' + editingUserId : '/api/admin/users';
    API(url, {
      method: editingUserId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (btn) btn.disabled = false;
      if (!d.ok) { if (hint) hint.textContent = d.error || '保存失败'; toast(d.error || '保存失败'); return; }
      toast(d.message || '已保存');
      closeUserForm();
      loadUsersTable();
      loadUnboundCases();
    }).catch(function () {
      if (btn) btn.disabled = false;
      if (hint) hint.textContent = '网络错误，请确认后端已启动';
    });
  }

  function deleteUser(btn) {
    var id = btn.getAttribute('data-del-user');
    var u = usersCache.find(function (x) { return String(x.id) === String(id); });
    if (btn.getAttribute('data-confirm') !== '1') {
      // 同时只允许一个删除按钮处于待确认态
      Array.prototype.forEach.call(
        document.querySelectorAll('#users-tbody button[data-del-user][data-confirm="1"]'),
        function (b) { b.setAttribute('data-confirm', '0'); b.textContent = '删除'; });
      btn.setAttribute('data-confirm', '1');
      btn.textContent = '确认删除？';
      toast('再次点击确认删除' + (u ? '（' + u.name + '）' : '') + '，5 秒后自动取消');
      setTimeout(function () {
        if (btn.getAttribute('data-confirm') === '1') {
          btn.setAttribute('data-confirm', '0');
          btn.textContent = '删除';
        }
      }, 5000);
      return;
    }
    btn.disabled = true;
    API('/api/admin/users/' + id, { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.disabled = false;
        if (!d.ok) { toast(d.error || '删除失败'); btn.textContent = '删除'; btn.setAttribute('data-confirm', '0'); return; }
        toast(d.message || '账号已删除');
        loadUsersTable();
        loadUnboundCases();
        loadReviewList();
      }).catch(function () { btn.disabled = false; toast('网络错误'); });
  }

  var usersTb = $('users-tbody');
  if (usersTb) usersTb.addEventListener('click', function (e) {
    var edit = e.target.closest('button[data-edit-user]');
    if (edit) {
      var id = edit.getAttribute('data-edit-user');
      var u = usersCache.find(function (x) { return String(x.id) === String(id); });
      if (u) openUserForm(u);
      return;
    }
    var del = e.target.closest('button[data-del-user]');
    if (del) deleteUser(del);
  });

  function setUnboundTitle(n) {
    var t = document.querySelector('#panel-bind .panel-title');
    if (!t) return;
    t.textContent = n > 0
      ? '患者身份绑定（未绑定 ' + n + ' 例）'
      : '患者身份绑定（暂无未绑定病例）';
  }

  function loadUnboundCases() {
    var panel = $('panel-bind');
    var tb = $('unbound-tbody');
    if (!panel || !tb) return;
    if (currentRole !== '机构管理员') { panel.hidden = true; return; }
    panel.hidden = false;
    API('/api/admin/unbound').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#b91c1c;padding:16px;">' +
          escapeHtml(d.error || '加载失败') + '</td></tr>';
        return;
      }
      tb.innerHTML = '';
      if (!d.cases.length) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:16px;">暂无未绑定病例</td></tr>';
        setUnboundTitle(0);
        return;
      }
      setUnboundTitle(d.cases.length);
      d.cases.forEach(function (c) {
        var opts = d.patients.map(function (p) {
          return '<option value="' + escapeHtml(p.phone) + '">' + escapeHtml(p.name + '（' + p.phone + '）') + '</option>';
        }).join('');
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + escapeHtml(c.case_no) + '</td>' +
          '<td>' + escapeHtml(c.patient_name || '—') + '</td>' +
          '<td>' + escapeHtml(c.part) + '</td>' +
          '<td>' + escapeHtml((c.created_at || '').slice(0, 10)) + '</td>' +
          '<td>' + statusBadge(c.status) + '</td>' +
          '<td><div style="display:flex; gap:6px;">' +
          '<select class="text-input" style="width:150px;" data-bind-phone>' + opts + '</select>' +
          '<button class="btn-line" type="button" data-bind="' + escapeHtml(c.case_no) + '">绑定</button>' +
          '</div></td>';
        tb.appendChild(tr);
      });
    }).catch(function () {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#b91c1c;padding:16px;">绑定列表加载失败</td></tr>';
    });
  }

  var unboundTb = $('unbound-tbody');
  if (unboundTb) unboundTb.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-bind]');
    if (!btn) return;
    var tr = btn.closest('tr');
    var sel = tr ? tr.querySelector('select[data-bind-phone]') : null;
    var phone = sel ? sel.value : '';
    if (!phone) { toast('请先在“新增账号”中开通患者账号'); return; }
    btn.disabled = true;
    API('/api/admin/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_no: btn.getAttribute('data-bind'), phone: phone })
    }).then(function (r) { return r.json(); }).then(function (d) {
      btn.disabled = false;
      if (!d.ok) { toast(d.error || '绑定失败'); return; }
      toast('绑定成功：' + d.binding.case_no + ' → ' + d.binding.patient_name);
      loadUnboundCases();
      loadUsersTable();
      loadReviewList();
    }).catch(function () { btn.disabled = false; toast('网络错误'); });
  });

  var reloadUnbound = $('btn-reload-unbound');
  if (reloadUnbound) reloadUnbound.addEventListener('click', function () { loadUnboundCases(); loadUsersTable(); });

  var newAcc = $('btn-new-account');
  if (newAcc) newAcc.addEventListener('click', function () { openUserForm(null); });
  var ufSave = $('btn-uf-save');
  if (ufSave) ufSave.addEventListener('click', saveUserForm);
  var ufCancel = $('btn-uf-cancel');
  if (ufCancel) ufCancel.addEventListener('click', closeUserForm);

  /* ---------- 管理员：新增档案（上传影像 → 真实推理 → 进入撰写） ---------- */
  var btnNewCase = $('btn-admin-new-case');
  var panelCaseCreate = $('panel-case-create');
  function refreshNewCaseBtn() { if (btnNewCase) btnNewCase.hidden = !isAdmin(); }
  refreshNewCaseBtn();

  if (btnNewCase) btnNewCase.addEventListener('click', function () {
    if (!panelCaseCreate) return;
    var shown = panelCaseCreate.style.display !== 'none';
    panelCaseCreate.style.display = shown ? 'none' : '';
    if (!shown) { var f = $('nc-name'); if (f) f.focus(); }
  });
  var ncCancel = $('btn-nc-cancel');
  if (ncCancel) ncCancel.addEventListener('click', function () {
    if (panelCaseCreate) panelCaseCreate.style.display = 'none';
  });

  function clearCaseCreateForm() {
    ['nc-name', 'nc-phone', 'nc-part', 'nc-sport', 'nc-date', 'nc-file'].forEach(function (id) {
      var el = $(id);
      if (el) el.value = '';
    });
    var h = $('nc-hint');
    if (h) h.textContent = '';
  }

  var ncSave = $('btn-nc-save');
  if (ncSave) ncSave.addEventListener('click', function () {
    var hint = $('nc-hint');
    var fileEl = $('nc-file');
    var file = fileEl && fileEl.files ? fileEl.files[0] : null;
    var part = ($('nc-part') && $('nc-part').value || '').trim();
    var phone = ($('nc-phone') && $('nc-phone').value || '').trim();
    if (!file) { if (hint) hint.textContent = '请选择影像文件（JPG / PNG）'; return; }
    if (!part) { if (hint) hint.textContent = '请填写受伤部位'; return; }
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) { if (hint) hint.textContent = '手机号格式不正确（11 位，1 开头）'; return; }

    var fd = new FormData();
    fd.append('file', file);
    fd.append('part', part);
    fd.append('patient_name', ($('nc-name') && $('nc-name').value || '').trim());
    fd.append('patient_phone', phone);
    fd.append('sport', ($('nc-sport') && $('nc-sport').value || '').trim());
    fd.append('injury_date', ($('nc-date') && $('nc-date').value || '').trim());

    ncSave.disabled = true;
    if (hint) hint.textContent = '正在上传并运行模型推理…';
    API('/api/analyze', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        ncSave.disabled = false;
        if (!d.ok) { if (hint) hint.textContent = d.error || '建档失败'; toast(d.error || '建档失败'); return; }
        var no = d.result.case_no;
        toast('档案已创建：' + no);
        clearCaseCreateForm();
        if (panelCaseCreate) panelCaseCreate.style.display = 'none';
        loadReviewList();
        loadSummary();
        openCaseByNo(no);
      })
      .catch(function () {
        ncSave.disabled = false;
        if (hint) hint.textContent = '网络错误，请确认后端已启动';
      });
  });

  /* ---------- 管理员：档案保存 / 删除 ---------- */
  var acSave = $('btn-ac-save');
  if (acSave) acSave.addEventListener('click', function () {
    if (!currentCase || !isAdmin()) return;
    var hint = $('ac-hint');
    var phone = ($('ac-phone') && $('ac-phone').value || '').trim();
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) { if (hint) hint.textContent = '手机号格式不正确（11 位，1 开头）'; return; }
    var body = {
      patient_name: ($('ac-name') && $('ac-name').value || '').trim(),
      patient_phone: phone,
      part: ($('ac-part') && $('ac-part').value || '').trim(),
      sport: ($('ac-sport') && $('ac-sport').value || '').trim(),
      injury_date: ($('ac-date') && $('ac-date').value || '').trim()
    };
    if (!body.part) { if (hint) hint.textContent = '部位不能为空'; return; }
    acSave.disabled = true;
    API('/api/admin/cases/' + encodeURIComponent(currentCase.case_no), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      acSave.disabled = false;
      if (!d.ok) { if (hint) hint.textContent = d.error || '保存失败'; toast(d.error || '保存失败'); return; }
      toast(d.message || '档案已更新');
      if (hint) hint.textContent = d.message || '';
      reloadDetail(currentCase.case_no);
      loadReviewList();
    }).catch(function () { acSave.disabled = false; if (hint) hint.textContent = '网络错误'; });
  });

  var acDelete = $('btn-ac-delete');
  if (acDelete) acDelete.addEventListener('click', function () {
    if (!currentCase || !isAdmin()) return;
    var caseNo = currentCase.case_no;
    var hint = $('ac-hint');
    if (acDelete.getAttribute('data-confirm') !== '1') {
      acDelete.setAttribute('data-confirm', '1');
      acDelete.textContent = '确认删除？';
      if (hint) hint.textContent = '删除后不可恢复：影像、随访、检测记录与操作记录会一并移除';
      toast('再次点击「确认删除」执行，5 秒后自动取消');
      setTimeout(function () {
        if (acDelete.getAttribute('data-confirm') === '1') {
          acDelete.setAttribute('data-confirm', '0');
          acDelete.textContent = '删除档案';
        }
      }, 5000);
      return;
    }
    acDelete.disabled = true;
    API('/api/admin/cases/' + encodeURIComponent(caseNo), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        acDelete.disabled = false;
        if (!d.ok) { toast(d.error || '删除失败'); acDelete.textContent = '删除档案'; acDelete.setAttribute('data-confirm', '0'); return; }
        toast(d.message || '档案已删除');
        currentCase = null;
        currentFull = null;
        window.__switchView('archive');
        loadReviewList();
        loadSummary();
      }).catch(function () {
        acDelete.disabled = false;
        toast('网络错误，请确认后端已启动');
      });
  });

  fromHash();
  if (!location.hash) switchView(myPerms.default);

  // 深链：dashboard.html?open=LSY-YYYYMMDD-001 直接打开病例详情
  var openParam = new URLSearchParams(location.search).get('open');
  if (openParam) openCaseByNo(openParam);
})();

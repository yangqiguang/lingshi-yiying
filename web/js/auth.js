/* =====================================================
   灵视医影 · 前端鉴权客户端
   - token 存取（localStorage）
   - dashboard.html 加载时校验登录态，未登录踢回 login.html
   - 退出登录时清除 token
   ===================================================== */
(function () {
  'use strict';
  var TOKEN_KEY = 'lingshi_token';
  var USER_KEY  = 'lingshi_user';

  function getToken()  { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return ''; } }
  function setToken(t){ try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} }
  function clearToken(){
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) {}
  }
  function getUser()  { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }
  function setUser(u) { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (e) {} }

  // 暴露给其他脚本
  window.Auth = {
    getToken: getToken,
    setToken: setToken,
    clear: clearToken,
    getUser: getUser,
    setUser: setUser,
    // 带鉴权头的 fetch
    fetch: function (url, options) {
      options = options || {};
      options.headers = options.headers || {};
      var t = getToken();
      if (t) options.headers['Authorization'] = 'Bearer ' + t;
      return fetch(url, options).then(function (resp) {
        if (resp.status === 401) {
          clearToken();
          if (!/login\.html/.test(location.pathname)) {
            location.href = 'login.html?switch=1';
          }
        }
        return resp;
      });
    }
  };

  // ---------- dashboard.html 进入校验 ----------
  if (/dashboard\.html/.test(location.pathname)) {
    var token = getToken();
    if (!token) {
      location.replace('login.html?switch=1');
      return;
    }
    // 同步用本地缓存先渲染，再用 /api/auth/me 校验
    fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 401) { clearToken(); location.replace('login.html?switch=1'); }
        else return r.json();
      })
      .then(function (data) {
        if (data && data.ok) {
          setUser(data.user);
          // 用后端返回的真实姓名覆盖页面上的展示（不影响 workbench.js 的角色逻辑）
          var topUser = document.getElementById('top-user');
          var accName = document.getElementById('acc-name');
          if (topUser) topUser.textContent = data.user.name;
          if (accName) accName.textContent = data.user.name;

          // 机构管理员：显示并加载"注册申请审核"面板
          if (data.user.role === '机构管理员') {
            var pa = document.getElementById('panel-approval');
            if (pa) pa.hidden = false;
            loadPendingApps();
            var reloadBtn = document.getElementById('btn-reload-apps');
            if (reloadBtn) reloadBtn.addEventListener('click', loadPendingApps);
          }
        }
      })
      .catch(function () { /* 离线时不阻塞演示 */ });
  }

  // ---------- 管理员：注册申请审核 ----------
  function loadPendingApps() {
    var tbody = document.getElementById('approval-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:18px;">加载中…</td></tr>';
    window.Auth.fetch('/api/admin/pending')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:18px;">' + (data.error || '加载失败') + '</td></tr>';
          return;
        }
        if (!data.applications.length) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:18px;">暂无待审核申请</td></tr>';
          return;
        }
        tbody.innerHTML = '';
        data.applications.forEach(function (app) {
          var tr = document.createElement('tr');
          var tdBase = document.createElement('td'); tdBase.textContent = app.name;
          var tdPhone = document.createElement('td'); tdPhone.textContent = app.phone;
          var tdOrg = document.createElement('td'); tdOrg.textContent = app.org;
          var tdRole = document.createElement('td');
          var badge = document.createElement('span'); badge.className = 'badge teal'; badge.textContent = app.role;
          tdRole.appendChild(badge);
          var tdTime = document.createElement('td'); tdTime.textContent = (app.created_at || '').replace('T', ' ');
          var tdOp = document.createElement('td');
          var b1 = document.createElement('button');
          b1.className = 'btn-line'; b1.style.color = '#0d9488'; b1.style.marginRight = '8px';
          b1.textContent = '通过';
          b1.onclick = function () { approveApp(app.id, app.name); };
          var b2 = document.createElement('button');
          b2.className = 'btn-line'; b2.style.color = '#dc2626';
          b2.textContent = '驳回';
          b2.onclick = function () { rejectApp(app.id); };
          tdOp.appendChild(b1); tdOp.appendChild(b2);
          tr.appendChild(tdBase); tr.appendChild(tdPhone); tr.appendChild(tdOrg);
          tr.appendChild(tdRole); tr.appendChild(tdTime); tr.appendChild(tdOp);
          tbody.appendChild(tr);
        });
      })
      .catch(function () {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:18px;">网络错误</td></tr>';
      });
  }
  function approveApp(id, name) {
    if (!confirm('确认通过「' + name + '」的注册申请？通过后自动开通账号。')) return;
    window.Auth.fetch('/api/admin/pending/' + id + '/approve', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          alert('已通过！\n登录账号：' + data.username + '（即手机号）\n密码：申请人注册时设置的密码');
          loadPendingApps();
        } else { alert(data.error || '操作失败'); }
      });
  }
  function rejectApp(id) {
    if (!confirm('确认驳回该申请？驳回后该手机号需重新提交。')) return;
    window.Auth.fetch('/api/admin/pending/' + id + '/reject', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) { alert('已驳回'); loadPendingApps(); }
        else { alert(data.error || '操作失败'); }
      });
  }

  // ---------- 退出登录 / 切换账号：清 token ----------
  function hookLogout() {
    ['btn-logout', 'btn-switch-account', 'top-logout', 'top-switch-account'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function () {
        clearToken();
        // 通知后端（失败不影响跳转）
        try { fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookLogout);
  } else {
    hookLogout();
  }
})();

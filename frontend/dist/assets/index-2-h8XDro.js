(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`31.97.169.57`,t=50,n={status:null,config:null,rows:[],search:``,filter:`all`,sortBy:`alpha`,currentPage:1,networkLatencyMs:null,networkOnline:!1,lastProbeAt:null,rdapExpiryCache:new Map,rdapPending:new Set,adminAvailable:!1,adminBusy:!1,adminMessage:``,sidebarOpen:!1},r=`olamulticom_rdap_expiry_v1`,i=10080*60*1e3,a=1440*60*1e3,o=2,s=[],c=0;function l(e){return new Intl.NumberFormat(`pt-BR`).format(e)}function u(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`)}function d(e){try{return new URL(e).hostname}catch{return e}}function f(e){try{let t=new URL(e);return t.protocol===`http:`||t.protocol===`https:`?t.toString():`#`}catch{return`#`}}function p(e){if(!e)return null;let t=new Date(e);return Number.isNaN(t.getTime())?null:t.toISOString()}function m(e){return e?new Date(e).toLocaleDateString(`pt-BR`):`Sem dados`}function h(e){if(!e)return`Sem dados`;let t=new Date(e).getTime()-Date.now(),n=Math.ceil(t/(1e3*60*60*24));return n<0?`Vencido há ${Math.abs(n)} dias`:n===0?`Vence hoje`:`Faltam ${n} dias`}function g(e){let t=e.toLowerCase();return t.endsWith(`.br`)&&!t.includes(`cprapid.com`)}function _(e,t){if(!t.length)return e;let n=e;for(let e of t){let t=e.replace(/[.*+?^${}()|[\]\\]/g,`\\$&`),r=RegExp(`(${t})`,`gi`);n=n.replace(r,`<mark class="search-hl">$1</mark>`)}return n}function v(){try{let e=localStorage.getItem(r);if(!e)return;let t=JSON.parse(e),o=Date.now();Object.entries(t).forEach(([e,t])=>{let r=t.expirationDate?i:a;t.fetchedAt+r>o&&n.rdapExpiryCache.set(e,t)})}catch{}}function y(){try{let e=Object.fromEntries(n.rdapExpiryCache.entries());localStorage.setItem(r,JSON.stringify(e))}catch{}}async function b(e){let t=await fetch(`https://rdap.registro.br/domain/${encodeURIComponent(e)}`,{cache:`no-store`});if(!t.ok)return null;let n=await t.json(),r=(Array.isArray(n?.events)?n.events:[]).find(e=>String(e?.eventAction||``).trim().toLowerCase()===`expiration`);return typeof r?.eventDate==`string`?r.eventDate:null}function x(e){if(e.expirationDate)return e.expirationDate;let t=d(e.site.url).toLowerCase();return n.rdapExpiryCache.get(t)?.expirationDate??null}function S(e){let t=e.toLowerCase();g(t)&&(n.rdapExpiryCache.has(t)||n.rdapPending.has(t)||s.includes(t)||s.push(t))}function C(){for(;c<o&&s.length>0;){let e=s.shift();if(!e)break;c+=1,n.rdapPending.add(e),b(e).then(t=>{n.rdapExpiryCache.set(e,{expirationDate:t,fetchedAt:Date.now()}),y()}).catch(()=>{n.rdapExpiryCache.set(e,{expirationDate:null,fetchedAt:Date.now()}),y()}).finally(()=>{n.rdapPending.delete(e),--c,n.status&&H(),C()})}}async function w(){let e=await fetch(`/status.json`,{cache:`no-store`});if(!e.ok)throw Error(`Não foi possível ler status.json (${e.status})`);return await e.json()}async function T(){try{return(await fetch(`/__admin/health`,{cache:`no-store`})).ok}catch{return!1}}async function E(){let e=await fetch(`/sites-config.json`,{cache:`no-store`});return e.ok?await e.json():null}function D(e){return e.whmInfo?.type===`principal`||e.category!==`whm`?`main`:`sub`}function O(e,t){let n=e.checks?.[0],r=new Map;return n?.results?.length&&n.results.forEach(e=>r.set(e.url.toLowerCase(),e)),[...t?.manualSites??[],...t?.whmSites??[]].forEach(e=>{let t=e.url.toLowerCase();r.has(t)||r.set(t,{name:e.name,url:e.url,online:!1,responseTime:-1,status:-1,error:`Sem verificação recente`,category:e.category,whmInfo:e.whmInfo})}),Array.from(r.values())}function k(e){return{site:e,type:D(e),account:e.whmInfo?.username||`manual:${e.name}`,expirationDate:p(e.whmInfo?.expirationDate||e.whmInfo?.expiresAt)}}function A(e,t){return O(e,t).map(e=>k(e)).sort((e,t)=>d(e.site.url).localeCompare(d(t.site.url))).map(e=>({site:e}))}function j(e,t){if(!t.length)return!0;let n=d(e.site.url).toLowerCase(),r=e.site.name.toLowerCase(),i=e.account.toLowerCase();return t.every(e=>n.includes(e)||r.includes(e)||i.includes(e))}function M(e){let t=n.search.trim().toLowerCase(),r=t?t.split(/\s+/).filter(Boolean):[],i=e.filter(e=>j(e.site,r)?n.filter===`cuenta`?e.site.type===`main`:n.filter===`adicionado`?e.site.type===`sub`:!0:!1);return n.sortBy===`alpha`?i.sort((e,t)=>d(e.site.site.url).localeCompare(d(t.site.site.url),`pt-BR`)):n.sortBy===`venc-mais-proximo`?i.sort((e,t)=>{let n=x(e.site),r=x(t.site);return!n&&!r?0:n?r?new Date(n).getTime()-new Date(r).getTime():-1:1}):n.sortBy===`venc-mais-distante`&&i.sort((e,t)=>{let n=x(e.site),r=x(t.site);return!n&&!r?0:n?r?new Date(r).getTime()-new Date(n).getTime():-1:1}),i}function N(e){let t=e.map(e=>e.site),r=t.filter(e=>e.type===`main`).length,i=t.filter(e=>e.type===`sub`).length,a=new Set(t.filter(e=>e.account&&!e.account.startsWith(`manual:`)).map(e=>e.account)).size,o=n.networkLatencyMs==null?`--`:`${n.networkLatencyMs}ms`,s=n.networkOnline?`Servidor online`:`Servidor offline`,c=n.networkOnline?`ok`:`bad`;return`
    <aside class="left-panel ${n.sidebarOpen?`open`:``}">
      <div class="sidebar-header-mobile">
        <span>Filtros</span>
        <button class="sidebar-close" id="sidebarCloseBtn" aria-label="Fechar menu">✕</button>
      </div>
      <div class="search-box">
        <input id="searchInput" type="text" placeholder="Buscar domínio..." value="${u(n.search)}" />
      </div>
      <article class="metric-card">
        <div class="metric-label">Servidor</div>
        <div class="metric-grid">
          <div class="metric-item">
            <span class="metric-item-label">Contas WHM</span>
            <span class="metric-item-value">${l(a)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-item-label">Domínios</span>
            <span class="metric-item-value">${l(r+i)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-item-label">Conta</span>
            <span class="metric-item-value">${l(r)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-item-label">Adicionado</span>
            <span class="metric-item-value">${l(i)}</span>
          </div>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Latência de Rede</div>
        <div class="metric-value ${c}">${o}</div>
        <div class="metric-sub">${s}</div>
      </article>
    </aside>
  `}function P(e){return e.status<0?`<span class="badge unknown">Sem check</span>`:e.online?`<span class="badge online">Online</span>`:`<span class="badge offline">Offline</span>`}function F(e){return e.cloudflareIp??e.ip??null}function I(t){return t===null?`<span class="hosting-label hosting-no">Não</span>`:t===e?`<span class="hosting-label hosting-yes" title="A Record: ${e} (WHM)">Sim</span>`:`<span class="hosting-label hosting-no" title="A Record: ${t} (fora WHM)">Não</span>`}function L(e){return e.type===`main`?`<span class="type-badge type-cuenta">Conta</span>`:`<span class="type-badge type-adicionado" title="Pertence à conta: ${u(e.account.startsWith(`manual:`)?`Manual`:e.account)}">Adicionado</span>`}function R(e){return e.type===`main`?``:`<span class="account-detail">→ ${u(e.account.startsWith(`manual:`)?`Manual`:e.account)}</span>`}function z(e,t){let r=d(e.site.site.url),i=f(e.site.site.url),a=x(e.site),o=n.search.trim().toLowerCase(),s=o?o.split(/\s+/).filter(Boolean):[],c=_(u(r),s),l=F(e.site.site),p=e.site.site.cloudflareIp?`CF`:e.site.site.ip?`DNS`:null;return`
    <tr>
      <td data-label="#">${t+1}</td>
      <td data-label="Domínio">
        <div class="domain-cell">
          <div class="domain-name">${c}</div>
        </div>
      </td>
      <td data-label="Tipo">
        <div class="type-cell">
          ${L(e.site)}
          ${R(e.site)}
        </div>
      </td>
      <td data-label="Status">${P(e.site.site)}</td>
      <td data-label="Vencimento">
        <div class="date-main">${m(a)}</div>
        <div class="date-sub">${h(a)}</div>
      </td>
      <td data-label="Servidor">
        <div class="hosting-cell">
          ${I(l)}
          ${l?`<span class="ip-detail" title="A Record via ${p}">${u(l)}</span>`:``}
        </div>
      </td>
      <td data-label="Ação">
        <div class="actions-cell">
          <a class="visit-link" href="${u(i)}" target="_blank" rel="noreferrer" title="Abrir domínio">↗</a>
        </div>
      </td>
    </tr>
  `}function B(e){let r=Math.ceil(e/t);if(r<=1)return``;let i=(n.currentPage-1)*t+1,a=Math.min(n.currentPage*t,e),o=``,s=Math.max(1,n.currentPage-3),c=Math.min(r,s+7-1);c-s<6&&(s=Math.max(1,c-7+1)),s>1&&(o+=`<button class="page-btn" data-page="1">1</button>`),s>2&&(o+=`<span class="page-ellipsis">…</span>`);for(let e=s;e<=c;e++)o+=`<button class="page-btn ${e===n.currentPage?`active`:``}" data-page="${e}">${e}</button>`;return c<r-1&&(o+=`<span class="page-ellipsis">…</span>`),c<r&&(o+=`<button class="page-btn" data-page="${r}">${r}</button>`),`
    <div class="pagination-bar">
      <span class="page-info">Mostrando ${i}–${a} de ${l(e)}</span>
      <div class="page-controls">
        <button class="page-btn page-nav" data-page="${n.currentPage-1}" ${n.currentPage<=1?`disabled`:``}>‹</button>
        ${o}
        <button class="page-btn page-nav" data-page="${n.currentPage+1}" ${n.currentPage>=r?`disabled`:``}>›</button>
      </div>
    </div>
  `}var V=0;function H(){let e=document.querySelector(`#tableBody`),r=document.querySelector(`#emptyResults`),i=document.querySelector(`#mainTable`),a=document.querySelector(`#pagination`);if(!e||!r||!i||!n.status)return;let o=M(n.rows),s=o.length,c=Math.ceil(s/t);if(n.currentPage>c&&(n.currentPage=Math.max(1,c)),s===0)e.innerHTML=``,i.style.display=`none`,r.style.display=`block`,r.textContent=n.search.trim()?`Não encontrado para: "${n.search.trim()}"`:`Sem resultados para este filtro.`,a&&(a.innerHTML=``);else{i.style.display=``,r.style.display=`none`,r.textContent=``;let c=(n.currentPage-1)*t;e.innerHTML=o.slice(c,c+t).map((e,t)=>z(e,c+t)).join(``),a&&(a.innerHTML=B(s))}}function U(){let e=document.querySelector(`#app`);if(!e||!n.status)return;let t=n.rows,r=M(t).length,i=`
    <section class="main-panel">
      <h1 class="desktop-title">Gestão de Domínios</h1>
      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${n.filter===`all`?`active`:``}" data-filter="all">Todos (${l(t.length)})</button>
          <button class="tab ${n.filter===`cuenta`?`active`:``}" data-filter="cuenta">Conta</button>
          <button class="tab ${n.filter===`adicionado`?`active`:``}" data-filter="adicionado">Adicionado</button>
        </div>
        <div class="actions">
          <select id="sortSelect">
            <option value="alpha" ${n.sortBy===`alpha`?`selected`:``}>Ordenar: A–Z</option>
            <option value="venc-mais-proximo" ${n.sortBy===`venc-mais-proximo`?`selected`:``}>Vencimento: mais próximo</option>
            <option value="venc-mais-distante" ${n.sortBy===`venc-mais-distante`?`selected`:``}>Vencimento: mais distante</option>
          </select>
          ${n.adminAvailable?`<button id="regenerateBtn" class="ghost" ${n.adminBusy?`disabled`:``}>${n.adminBusy?`Regenerando...`:`Limpar cache`}</button>`:``}
        </div>
      </div>
      ${n.adminMessage?`<p class="admin-note">${u(n.adminMessage)}</p>`:``}
      <div id="emptyResults" class="empty-results" style="display:none"></div>
      <div class="table-wrap">
        <table id="mainTable">
          <thead>
            <tr>
              <th>#</th>
              <th>Domínio</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Vencimento</th>
              <th>Servidor</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody id="tableBody"></tbody>
        </table>
        <div id="pagination"></div>
      </div>
      <div class="table-footer">
        <span class="total-count">Total: ${l(r)} domínios</span>
      </div>
    </section>
  `;e.innerHTML=`
    <header class="mobile-header">
      <button class="hamburger-btn" id="hamburgerBtn" aria-label="Abrir menu">
        <span></span><span></span><span></span>
      </button>
      <h1 class="mobile-title">Gestão de Domínios</h1>
    </header>
    <div class="sidebar-overlay ${n.sidebarOpen?` open`:``}" id="sidebarOverlay"></div>
    <main class="app-shell">
      ${N(t)}
      ${i}
    </main>
  `,W(),H()}function W(){document.getElementById(`hamburgerBtn`)?.addEventListener(`click`,()=>{n.sidebarOpen=!n.sidebarOpen,G()}),document.getElementById(`sidebarOverlay`)?.addEventListener(`click`,()=>{n.sidebarOpen=!1,G()}),document.getElementById(`sidebarCloseBtn`)?.addEventListener(`click`,()=>{n.sidebarOpen=!1,G()});let e=document.getElementById(`searchInput`);e?.addEventListener(`input`,()=>{n.search=e.value,n.currentPage=1,V&&cancelAnimationFrame(V),V=requestAnimationFrame(()=>{V=0,H()})}),document.querySelectorAll(`[data-filter]`).forEach(e=>{e.addEventListener(`click`,()=>{n.filter=e.dataset.filter,n.currentPage=1,U()})});let t=document.getElementById(`sortSelect`);t?.addEventListener(`change`,()=>{n.sortBy=t.value,n.currentPage=1,U()}),document.getElementById(`regenerateBtn`)?.addEventListener(`click`,async()=>{if(!n.adminBusy){n.adminBusy=!0,n.adminMessage=`Regenerando dados...`,U();try{let e=await fetch(`/__admin/regenerate`,{method:`POST`});if(!e.ok){let t=`HTTP ${e.status}`;try{let n=await e.json();n?.error&&(t=n.error)}catch{}throw Error(t)}let[t,r]=await Promise.all([w(),E()]);n.status=t,n.config=r,n.rows=A(t,r),n.adminMessage=`Cache limpo e dados regenerados com sucesso.`}catch(e){n.adminMessage=`Não foi possível regenerar: ${e.message}`}finally{n.adminBusy=!1,U()}}}),document.querySelector(`#pagination`)?.addEventListener(`click`,e=>{let t=e.target;if(t.tagName!==`BUTTON`||t.hasAttribute(`disabled`))return;let r=Number(t.dataset.page);r>=1&&(n.currentPage=r,H(),document.querySelector(`.table-wrap`)?.scrollTo({top:0,behavior:`smooth`}))})}function G(){let e=document.querySelector(`.left-panel`),t=document.getElementById(`sidebarOverlay`);e&&e.classList.toggle(`open`,n.sidebarOpen),t&&t.classList.toggle(`open`,n.sidebarOpen)}function K(){n.rows.forEach(({site:e})=>{e.type===`main`&&S(d(e.site.url).toLowerCase())}),C()}async function q(){let e=document.querySelector(`#app`);if(e)try{let[e,t]=await Promise.all([w(),E()]);n.status=e,n.config=t,n.adminAvailable=await T(),v(),n.rows=A(e,t),n.currentPage=1,U(),K()}catch(t){e.innerHTML=`<main class="app-shell"><p class="error">Erro ao carregar painel: ${t.message}</p></main>`}}async function J(){let e=Date.now();try{if(!(await fetch(`/status.json?probe=${e}`,{cache:`no-store`})).ok){n.networkOnline=!1,n.networkLatencyMs=null,n.lastProbeAt=Date.now(),n.status&&U();return}n.networkOnline=!0,n.networkLatencyMs=Date.now()-e,n.lastProbeAt=Date.now()}catch{n.networkOnline=!1,n.networkLatencyMs=null,n.lastProbeAt=Date.now()}n.status&&U()}q(),J(),setInterval(()=>J(),15e3);
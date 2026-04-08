(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))a(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const c of r.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&a(c)}).observe(document,{childList:!0,subtree:!0});function s(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function a(i){if(i.ep)return;i.ep=!0;const r=s(i);fetch(i.href,r)}})();const t={status:null,config:null,rows:[],search:"",statusFilter:"all",expanded:new Set,selectedYear:new Date().getFullYear(),networkLatencyMs:null,networkOnline:!1,lastProbeAt:null,rdapExpiryCache:new Map,rdapPending:new Set,adminAvailable:!1,adminBusy:!1,adminMessage:""},$e="olamulticom_rdap_expiry_v1",Le=7*24*60*60*1e3,Ie=24*60*60*1e3,De=2,P=[];let O=0;function C(e){return new Intl.NumberFormat("es-ES").format(e)}function l(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function ye(e){if(!e)return"Nunca";const n=new Date(e);return Number.isNaN(n.getTime())?"Nunca":n.toLocaleString("es-ES")}function S(e){try{return new URL(e).hostname}catch{return e}}function xe(e){try{const n=new URL(e);return n.protocol==="http:"||n.protocol==="https:"?n.toString():"#"}catch{return"#"}}function be(e,n){const s=e.toLowerCase(),a=n.toLowerCase();if(!a||a.startsWith("manual:"))return 0;if(s===a||s.startsWith(`${a}.`)||s.includes(`.${a}.`))return 1200;if(s.includes(a))return 700;const i=a.replace(/[^a-z0-9]/g,"");return i&&s.replace(/[^a-z0-9]/g,"").includes(i)?500:0}function Pe(e){if(!e)return null;const n=new Date(e);return Number.isNaN(n.getTime())?null:n.toISOString()}function Oe(e){return e?new Date(e).toLocaleDateString("es-ES"):"Sin dato"}function Re(e){if(!e)return"Sin dato";const n=new Date(e).getTime()-Date.now(),s=Math.ceil(n/(1e3*60*60*24));return s<0?`Vencido hace ${Math.abs(s)} dias`:s===0?"Vence hoy":`Faltan ${s} dias`}function Me(e){const n=e.toLowerCase();return n.endsWith(".br")&&!n.includes("cprapid.com")}function Te(){try{const e=localStorage.getItem($e);if(!e)return;const n=JSON.parse(e),s=Date.now();Object.entries(n).forEach(([a,i])=>{const r=i.expirationDate?Le:Ie;i.fetchedAt+r>s&&t.rdapExpiryCache.set(a,i)})}catch{}}function we(){try{const e=Object.fromEntries(t.rdapExpiryCache.entries());localStorage.setItem($e,JSON.stringify(e))}catch{}}async function Be(e){const n=await fetch(`https://rdap.registro.br/domain/${encodeURIComponent(e)}`,{cache:"no-store"});if(!n.ok)return null;const s=await n.json(),i=(Array.isArray(s==null?void 0:s.events)?s.events:[]).find(c=>String((c==null?void 0:c.eventAction)||"").trim().toLowerCase()==="expiration"),r=i==null?void 0:i.eventDate;return typeof r=="string"?r:null}function Fe(e){var s;if(e.expirationDate)return e.expirationDate;const n=S(e.site.url).toLowerCase();return((s=t.rdapExpiryCache.get(n))==null?void 0:s.expirationDate)??null}function He(e){const n=e.toLowerCase();Me(n)&&(t.rdapExpiryCache.has(n)||t.rdapPending.has(n)||P.includes(n)||P.push(n))}function _e(e){t.rows.filter(s=>s.kind==="child"&&s.parentKey===e).forEach(s=>{s.site.expirationDate||He(S(s.site.site.url))}),Ce()}function Ce(){for(;O<De&&P.length>0;){const e=P.shift();if(!e)break;O+=1,t.rdapPending.add(e),Be(e).then(n=>{t.rdapExpiryCache.set(e,{expirationDate:n,fetchedAt:Date.now()}),we()}).catch(()=>{t.rdapExpiryCache.set(e,{expirationDate:null,fetchedAt:Date.now()}),we()}).finally(()=>{t.rdapPending.delete(e),O-=1,t.status&&f(),Ce()})}}async function Se(){const e=await fetch("/status.json",{cache:"no-store"});if(!e.ok)throw new Error(`No se pudo leer status.json (${e.status})`);return await e.json()}async function Ye(){try{return(await fetch("/__admin/health",{cache:"no-store"})).ok}catch{return!1}}async function ke(){const e=await fetch("/sites-config.json",{cache:"no-store"});return e.ok?await e.json():null}function Ne(e){const n=new Set;return e.forEach(s=>{const a=new Date(s.timestamp);Number.isNaN(a.getTime())||n.add(a.getFullYear())}),n.size||n.add(new Date().getFullYear()),Array.from(n).sort((s,a)=>a-s)}function je(e,n){const s=new Map;return e.forEach(a=>{const i=new Date(a.timestamp);Number.isNaN(i.getTime())||i.getFullYear()!==n||a.results.forEach(r=>{const c=r.url.toLowerCase(),o=s.get(c)??{checks:0,online:0};o.checks+=1,r.online&&(o.online+=1),s.set(c,o)})}),s}function We(e){var n;return((n=e.whmInfo)==null?void 0:n.type)==="principal"||e.category!=="whm"?"main":"sub"}function qe(e,n){var r,c;const s=(r=e.checks)==null?void 0:r[0],a=new Map;return(c=s==null?void 0:s.results)!=null&&c.length&&s.results.forEach(o=>a.set(o.url.toLowerCase(),o)),[...(n==null?void 0:n.manualSites)??[],...(n==null?void 0:n.whmSites)??[]].forEach(o=>{const d=o.url.toLowerCase();a.has(d)||a.set(d,{name:o.name,url:o.url,online:!1,responseTime:-1,status:-1,error:"Sin verificacion reciente",category:o.category,whmInfo:o.whmInfo})}),Array.from(a.values())}function Ke(e,n){var c,o,d,p;const s=e.url.toLowerCase(),a=n.get(s)??{checks:0,online:0},i=a.checks,r=a.online;return{site:e,visits:i,uniqueVisits:r,type:We(e),account:((c=e.whmInfo)==null?void 0:c.username)||`manual:${e.name}`,subCount:0,expirationDate:Pe(((o=e.whmInfo)==null?void 0:o.expirationDate)||((d=e.whmInfo)==null?void 0:d.expiresAt)),mailAccountsCount:((p=e.whmInfo)==null?void 0:p.mailAccountsCount)??null}}function R(e,n,s){const a=je(e.checks,s),i=qe(e,n).map(o=>Ke(o,a)),r=new Map;i.forEach(o=>{const d=r.get(o.account)??[];d.push(o),r.set(o.account,d)});const c=[];return Array.from(r.keys()).sort((o,d)=>o.localeCompare(d,"es")).forEach(o=>{const d=r.get(o)??[],p=d.filter(u=>u.type==="main").sort((u,m)=>m.visits-u.visits),y=[...d].sort((u,m)=>m.visits-u.visits);if(!y.length)return;const k=u=>[...u].sort((m,E)=>{const v=S(m.site.url),g=S(E.site.url),L=be(v,o),I=be(g,o);if(L!==I)return I-L;const D=v.includes("cprapid.com")?1:0,x=g.includes("cprapid.com")?1:0;if(D!==x)return D-x;const b=(v.match(/\./g)||[]).length,w=(g.match(/\./g)||[]).length;return b!==w?b-w:v.length!==g.length?v.length-g.length:E.visits-m.visits})[0],h=p.length?k(p):k(y),N=h.site.url.toLowerCase(),A=y.filter(u=>u.site.url.toLowerCase()!==N);h.subCount=A.length,c.push({site:h,kind:"parent"}),A.forEach(u=>{u.mailAccountsCount==null&&h.mailAccountsCount!=null&&(u.mailAccountsCount=h.mailAccountsCount),c.push({site:u,kind:"child",parentKey:N})})}),c}function ze(e){const n=t.search.trim().toLowerCase(),s=new Set;return e.forEach(a=>{const i=!n||a.site.site.name.toLowerCase().includes(n)||a.site.site.url.toLowerCase().includes(n)||a.site.account.toLowerCase().includes(n),r=t.statusFilter==="all"||t.statusFilter==="online"&&a.site.site.online||t.statusFilter==="offline"&&!a.site.site.online;i&&r&&(a.kind==="parent"?s.add(a.site.site.url.toLowerCase()):a.parentKey&&s.add(a.parentKey))}),e.filter(a=>a.kind==="parent"?s.has(a.site.site.url.toLowerCase()):a.parentKey?s.has(a.parentKey)&&t.expanded.has(a.parentKey):!1)}function Ge(e){const n=new Map;return e.forEach(s=>{n.set(s.site.site.url.toLowerCase(),s.site)}),Array.from(n.values())}function Ve(e){e.filter(o=>o.kind==="parent");const n=Ge(e),s=n.filter(o=>o.type==="main").length,a=n.filter(o=>o.type==="sub").length,i=t.networkLatencyMs==null?"--":`${t.networkLatencyMs}ms`,r=t.networkOnline?"Servidor online":"Servidor offline",c=t.networkOnline?"ok":"bad";return`
    <aside class="left-panel">
      <div class="search-box">
        <input id="searchInput" type="text" placeholder="Buscar por dominio..." value="${l(t.search)}" />
      </div>
      <article class="metric-card">
        <div class="metric-label">Total de Dominios</div>
        <div class="metric-value">${C(s)}</div>
      </article>
      <article class="metric-card">
        <div class="metric-label">Total de Subdominios</div>
        <div class="metric-value">${C(a)}</div>
      </article>
      <article class="metric-card latency">
        <div class="metric-label">Latencia de Red</div>
        <div class="metric-value ${c}">${i}</div>
        <div class="metric-sub">${r}</div>
      </article>
    </aside>
  `}function Ue(e){return e.status<0?'<span class="badge unknown">Sin check</span>':e.online?'<span class="badge online">Online</span>':'<span class="badge offline">Offline</span>'}function Qe(e,n){const s=e.kind==="parent"?e.site.site.url.toLowerCase():e.parentKey??"",a=t.expanded.has(s),i=e.kind==="parent"&&e.site.subCount>0,r=S(e.site.site.url),c=xe(e.site.site.url),o=Fe(e.site),d=e.site.mailAccountsCount,p=d==null?e.site.site.category==="whm"?"Sin permiso":"N/A":C(d);return`
    <tr class="${e.kind==="child"?"child-row":""}">
      <td>${e.kind==="parent"?n+1:""}</td>
      <td>
        <div class="domain-cell ${e.kind==="child"?"is-child":""}">
          ${i?`<button class="toggle" data-toggle="${s}">${a?"▾":"▸"}</button>`:'<span class="toggle placeholder"></span>'}
          <div>
            <div class="domain-name">${l(r)}</div>
            ${e.kind==="parent"&&e.site.subCount>0?`<div class="domain-sub">+${e.site.subCount} dominios/subdominios en la cuenta</div>`:""}
          </div>
        </div>
      </td>
      <td>${Ue(e.site.site)}</td>
      <td>
        <div class="date-main">${Oe(o)}</div>
        <div class="date-sub">${Re(o)}</div>
      </td>
      <td>
        <div class="visit-main">${C(e.site.visits)}</div>
        <div class="visit-sub">${C(e.site.uniqueVisits)} online</div>
      </td>
      <td>
        <div class="date-main">${p}</div>
      </td>
      <td><a class="visit-link" href="${l(c)}" target="_blank" rel="noreferrer">↗</a></td>
    </tr>
  `}function f(){var b,w,M,T,B,F,H,_,Y,j,W,q,K,z,G,V,U,Q,J,X,Z,ee,te,ne,se,ae,re,ie,oe,ce,le,de,ue,pe,fe,me,he,ve,ge;const e=document.querySelector("#app");if(!e||!t.status)return;const n=t.rows,s=ze(n),a=Ne(t.status.checks),i=((w=(b=t.config)==null?void 0:b.serverInfo)==null?void 0:w.host)||"No disponible",r=((T=(M=t.config)==null?void 0:M.serverInfo)==null?void 0:T.ip)||"No disponible",c=((F=(B=t.config)==null?void 0:B.serverInfo)==null?void 0:F.plan)||"No disponible",o=((_=(H=t.config)==null?void 0:H.serverInfo)==null?void 0:_.system)||"No disponible",d=((j=(Y=t.config)==null?void 0:Y.serverInfo)==null?void 0:j.reverseDns)||"No disponible",p=((q=(W=t.config)==null?void 0:W.serverInfo)==null?void 0:q.whoisOrg)||"No disponible",y=((z=(K=t.config)==null?void 0:K.serverInfo)==null?void 0:z.whoisCountry)||"No disponible",k=((V=(G=t.config)==null?void 0:G.serverInfo)==null?void 0:V.whoisNetName)||"No disponible",h=((Q=(U=t.config)==null?void 0:U.serverInfo)==null?void 0:Q.whoisAsn)||"No disponible",N=((X=(J=t.config)==null?void 0:J.serverInfo)==null?void 0:X.httpServer)||"No disponible",A=((ee=(Z=t.config)==null?void 0:Z.serverInfo)==null?void 0:ee.osGuess)||"No disponible",u=((ne=(te=t.config)==null?void 0:te.serverInfo)==null?void 0:ne.isp)||"No disponible",m=((ae=(se=t.config)==null?void 0:se.serverInfo)==null?void 0:ae.asName)||"No disponible",E=((ie=(re=t.config)==null?void 0:re.serverInfo)==null?void 0:ie.geoCity)||"No disponible",v=((ce=(oe=t.config)==null?void 0:oe.serverInfo)==null?void 0:ce.geoRegion)||"No disponible",g=((de=(le=t.config)==null?void 0:le.serverInfo)==null?void 0:de.geoCountry)||"No disponible",L=((pe=(ue=t.config)==null?void 0:ue.serverInfo)==null?void 0:pe.geoTimezone)||"No disponible",I=((me=(fe=t.config)==null?void 0:fe.serverInfo)==null?void 0:me.ipApiSource)||"No disponible",D=ye((ve=(he=t.config)==null?void 0:he.serverInfo)==null?void 0:ve.probedAt),x=`
    <section class="main-panel">
      <h1>Gestao de Dominios</h1>
      <article class="server-card">
        <div class="server-title">Servidor Ola Multicom</div>
        <div class="server-grid">
          <div><span>Host:</span> ${l(i)}</div>
          <div><span>IP:</span> ${l(r)}</div>
          <div><span>Reverse DNS:</span> ${l(d)}</div>
          <div><span>HTTP Server:</span> ${l(N)}</div>
          <div><span>ASN:</span> ${l(h)}</div>
          <div><span>WHOIS Org:</span> ${l(p)}</div>
          <div><span>WHOIS Pais:</span> ${l(y)}</div>
          <div><span>WHOIS NetName:</span> ${l(k)}</div>
          <div><span>ISP:</span> ${l(u)}</div>
          <div><span>ASN Org:</span> ${l(m)}</div>
          <div><span>Ciudad:</span> ${l(E)}</div>
          <div><span>Region:</span> ${l(v)}</div>
          <div><span>Pais:</span> ${l(g)}</div>
          <div><span>Timezone:</span> ${l(L)}</div>
          <div><span>API Fuente:</span> ${l(I)}</div>
          <div><span>OS Guess:</span> ${l(A)}</div>
          <div><span>Plano:</span> ${l(c)}</div>
          <div><span>Sistema:</span> ${l(o)}</div>
          <div><span>WHM Sync:</span> ${ye((ge=t.config)==null?void 0:ge.lastWhmSync)}</div>
          <div><span>Analisis:</span> ${l(D)}</div>
        </div>
      </article>

      <div class="toolbar">
        <div class="tabs">
          <button class="tab ${t.statusFilter==="all"?"active":""}" data-filter="all">Todos</button>
          <button class="tab ${t.statusFilter==="online"?"active":""}" data-filter="online">Online</button>
          <button class="tab ${t.statusFilter==="offline"?"active":""}" data-filter="offline">Offline</button>
        </div>
        <div class="actions">
          <select id="yearSelect">
            ${a.map($=>`<option value="${$}" ${$===t.selectedYear?"selected":""}>Checks (${$})</option>`).join("")}
          </select>
          ${t.adminAvailable?`<button id="regenerateBtn" class="ghost" ${t.adminBusy?"disabled":""}>${t.adminBusy?"Regenerando...":"Limpiar cache y regenerar"}</button>`:""}
          <button id="expandAllBtn" class="ghost">Expandir todos</button>
          <button id="collapseAllBtn" class="ghost">Contraer todos</button>
        </div>
      </div>
      ${t.adminMessage?`<p class="admin-note">${l(t.adminMessage)}</p>`:""}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Dominio Principal</th>
              <th>Status</th>
              <th>Vencimiento</th>
              <th>Checks (${t.selectedYear})</th>
              <th>Correos</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            ${s.map(($,Ee)=>Qe($,Ee)).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;e.innerHTML=`<main class="app-shell">${Ve(n)}${x}</main>`,Je()}function Je(){var s,a,i;const e=document.getElementById("searchInput");e==null||e.addEventListener("input",()=>{t.search=e.value,f()}),document.querySelectorAll("[data-filter]").forEach(r=>{r.addEventListener("click",()=>{const c=r.dataset.filter;t.statusFilter=c,f()})}),document.querySelectorAll("[data-toggle]").forEach(r=>{r.addEventListener("click",()=>{const c=r.dataset.toggle;c&&(t.expanded.has(c)?t.expanded.delete(c):(t.expanded.add(c),_e(c)),f())})});const n=document.getElementById("yearSelect");n==null||n.addEventListener("change",()=>{t.selectedYear=Number(n.value),t.status&&(t.rows=R(t.status,t.config,t.selectedYear)),f()}),(s=document.getElementById("expandAllBtn"))==null||s.addEventListener("click",()=>{t.rows.filter(r=>r.kind==="parent"&&r.site.subCount>0).forEach(r=>{t.expanded.add(r.site.site.url.toLowerCase())}),f()}),(a=document.getElementById("collapseAllBtn"))==null||a.addEventListener("click",()=>{t.expanded.clear(),f()}),(i=document.getElementById("regenerateBtn"))==null||i.addEventListener("click",async()=>{if(!t.adminBusy){t.adminBusy=!0,t.adminMessage="Regenerando datos...",f();try{const r=await fetch("/__admin/regenerate",{method:"POST"});if(!r.ok){let d=`HTTP ${r.status}`;try{const p=await r.json();p!=null&&p.error&&(d=p.error)}catch{}throw new Error(d)}const[c,o]=await Promise.all([Se(),ke()]);t.status=c,t.config=o,t.rows=R(c,o,t.selectedYear),t.adminMessage="Cache limpiado y datos regenerados correctamente."}catch(r){t.adminMessage=`No se pudo regenerar: ${r.message}`}finally{t.adminBusy=!1,f()}}})}async function Xe(){const e=document.querySelector("#app");if(e)try{const[n,s]=await Promise.all([Se(),ke()]);t.status=n,t.config=s,t.adminAvailable=await Ye(),Te();const a=Ne(n.checks);t.selectedYear=a[0],t.rows=R(n,s,t.selectedYear),t.expanded.clear(),f()}catch(n){e.innerHTML=`<main class="app-shell"><p class="error">Error cargando dashboard: ${n.message}</p></main>`}}async function Ae(){const e=Date.now();try{if(!(await fetch(`/status.json?probe=${e}`,{cache:"no-store"})).ok){t.networkOnline=!1,t.networkLatencyMs=null,t.lastProbeAt=Date.now(),t.status&&f();return}t.networkOnline=!0,t.networkLatencyMs=Date.now()-e,t.lastProbeAt=Date.now()}catch{t.networkOnline=!1,t.networkLatencyMs=null,t.lastProbeAt=Date.now()}t.status&&f()}Xe();Ae();setInterval(()=>{Ae()},15e3);

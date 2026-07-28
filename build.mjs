#!/usr/bin/env node
// 모두랭킹 static site generator
// Usage: node build.mjs
// Reads data/site.json + data/rankings/*.json, writes HTML to repo root.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const RANK_DIR = join(DATA, "rankings");

const site = JSON.parse(readFileSync(join(DATA, "site.json"), "utf8"));
const rankings = readdirSync(RANK_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(RANK_DIR, f), "utf8")));

const byCat = (slug) =>
  rankings
    .filter((r) => r.category === slug)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

const catBySlug = Object.fromEntries(site.categories.map((c) => [c.slug, c]));

// ---------- helpers ----------
const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const rankClass = (n) => (n === 1 ? "r1" : n === 2 ? "r2" : n === 3 ? "r3" : "");

function navHtml(active) {
  const links = [`<a href="index.html"${active === "home" ? ' class="active"' : ""}>홈</a>`];
  for (const c of site.categories) {
    links.push(
      `<a href="${c.slug}.html"${active === c.slug ? ' class="active"' : ""}>${esc(c.name)}</a>`
    );
  }
  return links.join("\n");
}

function layout({ title, description, active, body, canonical }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="https://www.${site.domain}/${canonical}">` : ""}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
<link rel="stylesheet" href="assets/style.css">
<script>
  (function(){try{var t=localStorage.getItem('mr-theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
</script>
</head>
<body>
<header class="site-header">
  <div class="header-inner wrap">
    <a href="index.html" class="brand">모두랭킹<span class="dot">.</span><span class="sub">${esc(site.tagline)}</span></a>
    <nav class="nav">
${navHtml(active)}
    </nav>
    <button class="theme-toggle" id="themeToggle" aria-label="라이트/다크 전환" title="라이트/다크 전환">◐</button>
  </div>
</header>
<main>
  <div class="wrap">
${body}
  </div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <p class="foot-brand">모두랭킹 <span style="color:var(--accent)">·</span> ${esc(site.domain)}</p>
    <p>${esc(site.tagline_full)}</p>
    <p class="footer-links"><a href="about.html">사이트 소개</a><a href="privacy.html">개인정보처리방침</a><a href="contact.html">문의</a></p>
    <p class="footer-note">본 사이트의 모든 랭킹은 각 페이지에 표기된 <b>공식·집계 출처</b>에서 수집한 데이터를 기반으로 하며, 수집 시점의 스냅샷입니다. 실시간 수치와 다를 수 있으니 이용 전 원본 출처를 확인하시기 바랍니다. 인용된 각 데이터의 권리는 해당 출처에 있습니다.</p>
  </div>
</footer>
<script>
  (function(){
    var btn=document.getElementById('themeToggle');
    if(!btn)return;
    btn.addEventListener('click',function(){
      var cur=document.documentElement.getAttribute('data-theme');
      var next= cur==='dark' ? 'light' : (cur==='light' ? 'dark' :
        (window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light':'dark'));
      document.documentElement.setAttribute('data-theme',next);
      try{localStorage.setItem('mr-theme',next);}catch(e){}
    });
  })();
</script>
</body>
</html>`;
}

// ---------- ranking page ----------
function rankItemHtml(it, idx) {
  const n = it.rank ?? idx + 1;
  const name = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.name)}</a>`
    : esc(it.name);
  const val = it.value
    ? `<div class="rank-value">${esc(it.value)}${it.value_sub ? `<small>${esc(it.value_sub)}</small>` : ""}</div>`
    : `<div class="rank-value"></div>`;
  return `<li class="rank-item${n <= 3 ? " top" : ""}">
  <span class="rank-badge ${rankClass(n)}">${n}</span>
  <div class="rank-main">
    <p class="rank-name">${name}</p>
    ${it.sub ? `<p class="rank-sub">${esc(it.sub)}</p>` : ""}
  </div>
  ${val}
</li>`;
}

function renderRanking(r) {
  const cat = catBySlug[r.category];
  const items = r.items.map(rankItemHtml).join("\n");
  const body = `<nav class="breadcrumb"><a href="index.html">홈</a> › <a href="${cat.slug}.html">${esc(cat.name)}</a> › ${esc(r.title)}</nav>
<span class="eyebrow">${esc(cat.name)} 랭킹</span>
<h1 class="page-title">${esc(r.title)}</h1>
<p class="lead">${esc(r.intro)}</p>
<div class="source-bar">
  <span><span class="k">출처</span> ${r.source_url ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(r.source)}</a>` : esc(r.source)}</span>
  <span class="sep">|</span>
  <span><span class="k">수집일</span> ${esc(r.collected_date)}</span>
  ${r.value_label ? `<span class="sep">|</span><span><span class="k">기준</span> ${esc(r.value_label)}</span>` : ""}
</div>
<ol class="rank-list">
${items}
</ol>
${r.closing ? `<p class="closing">${esc(r.closing)}</p>` : ""}
<p class="disclaimer">* 위 랭킹은 ${esc(r.collected_date)} 기준 ${esc(r.source)} 데이터를 정리한 것으로, 집계 시점과 방식에 따라 실제 순위가 달라질 수 있습니다.</p>`;
  return layout({
    title: `${r.title} (${r.collected_date} 기준) | 모두랭킹`,
    description: `${r.intro}`.slice(0, 150),
    active: r.category,
    canonical: `${r.slug}.html`,
    body,
  });
}

// ---------- category hub ----------
function renderCategory(cat) {
  const rs = byCat(cat.slug);
  const cards = rs
    .map(
      (r) => `<a class="card" href="${r.slug}.html">
  <h3>${esc(r.title)}</h3>
  <p>${esc(r.card_desc || r.intro)}</p>
  <span class="card-src">출처 · ${esc(r.source)} · ${esc(r.collected_date)}</span>
</a>`
    )
    .join("\n");
  const body = `<nav class="breadcrumb"><a href="index.html">홈</a> › ${esc(cat.name)}</nav>
<span class="eyebrow">Category</span>
<h1 class="page-title">${esc(cat.name)} 랭킹</h1>
<p class="lead">${esc(cat.desc)}</p>
<div class="section-head"><h2>랭킹 ${rs.length}</h2></div>
<div class="card-grid two">
${cards || "<p>준비 중입니다.</p>"}
</div>`;
  return layout({
    title: `${cat.name} 랭킹 모음 | 모두랭킹`,
    description: cat.desc,
    active: cat.slug,
    canonical: `${cat.slug}.html`,
    body,
  });
}

// ---------- home ----------
function renderHome() {
  const featured = rankings.filter((r) => r.featured).sort((a, b) => (a.feat_order ?? 99) - (b.feat_order ?? 99));
  const featCards = featured
    .map((r) => {
      const cat = catBySlug[r.category];
      const mini = r.items
        .slice(0, 3)
        .map(
          (it, i) =>
            `<li><span class="n">${i + 1}</span><span class="nm">${esc(it.name)}</span>${it.value ? `<span class="v">${esc(it.value)}</span>` : ""}</li>`
        )
        .join("");
      return `<a class="card feature-card" href="${r.slug}.html">
  <span class="badge-live">${esc(cat.name)}</span>
  <h3>${esc(r.title)}</h3>
  <ol class="mini-rank">${mini}</ol>
  <span class="card-src">출처 · ${esc(r.source)} · ${esc(r.collected_date)}</span>
</a>`;
    })
    .join("\n");

  const catCards = site.categories
    .map((c) => {
      const cnt = byCat(c.slug).length;
      return `<a class="card" href="${c.slug}.html">
  <span class="cat-icon">${c.icon}</span>
  <h3>${esc(c.name)}</h3>
  <p>${esc(c.desc)}</p>
  <span class="card-src">랭킹 ${cnt}개</span>
</a>`;
    })
    .join("\n");

  const body = `<section class="hero">
  <span class="eyebrow">MODU RANKING</span>
  <h1>세상 궁금한 <span class="hl">모든 랭킹</span>을<br>한곳에서.</h1>
  <p class="lead">PC방 게임 점유율부터 실시간 음원차트, 박스오피스, 앱 다운로드 순위까지 — 공식·집계 데이터로 검증한 랭킹만 모았습니다.</p>
</section>

<div class="section-head"><h2>이번 주 주목 랭킹</h2></div>
<div class="card-grid">
${featCards}
</div>

<div class="section-head"><h2>카테고리</h2></div>
<div class="card-grid">
${catCards}
</div>`;
  return layout({
    title: "모두랭킹 | 세상 궁금한 모든 랭킹",
    description: "PC방 게임 순위, 실시간 음원차트, 박스오피스, 앱 다운로드 순위 등 공식·집계 데이터 기반 랭킹 모음. 모두랭킹.",
    active: "home",
    canonical: "",
    body,
  });
}

// ---------- static prose pages ----------
function renderProse(slug, title, inner) {
  return layout({
    title: `${title} | 모두랭킹`,
    description: `모두랭킹 ${title}`,
    active: "",
    canonical: `${slug}.html`,
    body: `<h1 class="page-title">${esc(title)}</h1>\n<div class="prose">\n${inner}\n</div>`,
  });
}

// ---------- write everything ----------
const out = {};
out["index.html"] = renderHome();
for (const c of site.categories) out[`${c.slug}.html`] = renderCategory(c);
for (const r of rankings) out[`${r.slug}.html`] = renderRanking(r);

out["about.html"] = renderProse(
  "about",
  "사이트 소개",
  `<p>모두랭킹(${site.domain})은 "세상 궁금한 모든 랭킹"을 한곳에 모으는 것을 목표로 하는 종합 랭킹 사이트입니다.</p>
<h2>우리가 다루는 것</h2>
<p>게임 점유율, 음원·영상 차트, 박스오피스, 앱 다운로드, 베스트셀러 등 <b>공식 기관이나 신뢰할 수 있는 집계처가 발표하는 데이터</b>를 기반으로 랭킹을 정리합니다. 각 랭킹 페이지에는 출처와 수집일을 함께 표기합니다.</p>
<h2>데이터 원칙</h2>
<ul>
<li>모든 랭킹은 출처가 명확한 데이터만 사용합니다.</li>
<li>정적 페이지 특성상 수집 시점의 스냅샷이며, 실시간 수치와 차이가 있을 수 있습니다.</li>
<li>인용된 데이터의 권리는 각 출처에 있으며, 원본 확인을 권장합니다.</li>
</ul>`
);

out["privacy.html"] = renderProse(
  "privacy",
  "개인정보처리방침",
  `<p>모두랭킹은 이용자의 개인정보를 소중히 여기며 관련 법령을 준수합니다.</p>
<h2>수집하는 개인정보</h2>
<p>본 사이트는 회원가입이나 로그인 기능을 제공하지 않으며, 이름·연락처 등 직접적인 개인정보를 수집하지 않습니다.</p>
<h2>접속 통계 및 광고</h2>
<p>서비스 개선을 위해 익명화된 접속 통계 도구가 사용될 수 있으며, 광고가 게재되는 경우 광고 사업자의 쿠키 정책이 적용될 수 있습니다. 브라우저 설정에서 쿠키를 거부할 수 있습니다.</p>
<h2>문의</h2>
<p>개인정보 관련 문의는 문의 페이지를 통해 접수해 주시기 바랍니다.</p>`
);

out["contact.html"] = renderProse(
  "contact",
  "문의",
  `<p>모두랭킹에 대한 제휴·제안·오류 신고는 아래 이메일로 보내주세요.</p>
<h2>이메일</h2>
<p><a href="mailto:${site.contact_email}">${site.contact_email}</a></p>
<h2>랭킹 오류 제보</h2>
<p>수치나 출처에 오류가 있다면 해당 페이지 주소와 함께 알려주시면 검토 후 반영하겠습니다.</p>`
);

// 404
out["404.html"] = layout({
  title: "페이지를 찾을 수 없습니다 | 모두랭킹",
  description: "요청하신 페이지를 찾을 수 없습니다.",
  active: "",
  canonical: "",
  body: `<section class="hero" style="text-align:center">
  <span class="eyebrow">404</span>
  <h1>찾으시는 랭킹이 여기 없네요.</h1>
  <p class="lead" style="margin-left:auto;margin-right:auto">주소가 바뀌었거나 삭제된 페이지일 수 있습니다. 아래에서 다른 랭킹을 둘러보세요.</p>
  <p style="margin-top:20px"><a class="card" style="display:inline-flex;max-width:220px" href="index.html"><h3>홈으로 가기 →</h3></a></p>
</section>
<div class="section-head"><h2>카테고리</h2></div>
<div class="card-grid">
${site.categories.map((c) => `<a class="card" href="${c.slug}.html"><span class="cat-icon">${c.icon}</span><h3>${esc(c.name)}</h3><p>${esc(c.desc)}</p></a>`).join("\n")}
</div>`,
});

// sitemap + robots
const urls = ["", ...site.categories.map((c) => `${c.slug}.html`), ...rankings.map((r) => `${r.slug}.html`), "about.html", "privacy.html", "contact.html"];
out["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>https://www.${site.domain}/${u}</loc></url>`).join("\n")}
</urlset>`;
out["robots.txt"] = `User-agent: *\nAllow: /\nSitemap: https://www.${site.domain}/sitemap.xml\n`;

// write
if (!existsSync(join(ROOT, "assets"))) mkdirSync(join(ROOT, "assets"));
let count = 0;
for (const [name, html] of Object.entries(out)) {
  writeFileSync(join(ROOT, name), html, "utf8");
  count++;
}
console.log(`Generated ${count} files: ${site.categories.length} categories, ${rankings.length} rankings.`);

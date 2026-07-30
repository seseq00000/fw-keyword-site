#!/usr/bin/env node
// 모두랭킹 Instagram carousel generator
// Usage:
//   node social.mjs                 # 오늘 추천 랭킹 자동 선정
//   node social.mjs <slug> [slug…]  # 특정 랭킹 지정
//
// 랭킹 JSON을 읽어 1080x1350 캐러셀 슬라이드를 HTML로 뽑고, 캡션(.txt)을 함께 만든다.
// HTML → JPEG 변환은 렌더러가 담당한다(.github/workflows/social.yml 의 Playwright).
// 사이트와 같은 폰트·팔레트를 쓰기 위해 SVG가 아닌 HTML을 쓴다.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const OUT = join(ROOT, "social");

const site = JSON.parse(readFileSync(join(DATA, "site.json"), "utf8"));
const catBySlug = Object.fromEntries(site.categories.map((c) => [c.slug, c]));
const rankings = readdirSync(join(DATA, "rankings"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DATA, "rankings", f), "utf8")));

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- which rankings to post ----------
// Default: freshest first, preferring featured — the same instinct as the home page.
function pick(args) {
  if (args.length) {
    return args.map((s) => {
      const r = rankings.find((x) => x.slug === s);
      if (!r) throw new Error(`unknown ranking: ${s}`);
      return r;
    });
  }
  return [...rankings]
    .sort(
      (a, b) =>
        (b.featured ? 1 : 0) - (a.featured ? 1 : 0) ||
        String(b.collected_date).localeCompare(String(a.collected_date)) ||
        a.slug.localeCompare(b.slug)
    )
    .slice(0, 3);
}

// ---------- slide shell ----------
const FONT =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css";

function slide(inner, extraClass = "") {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<link rel="stylesheet" href="${FONT}">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --brand:#1f3864; --accent:#e0503a; --gold:#c8a23c; --silver:#9aa4b2; --bronze:#b07a4a;
    --ink:#17203a; --soft:#55607a; --mute:#8a92a6; --line:#e6e8ec; --bg:#fff; --bgsoft:#f6f7f9;
  }
  html,body{width:1080px;height:1350px}
  body{
    font-family:"Pretendard Variable",Pretendard,system-ui,sans-serif;
    background:var(--bg); color:var(--ink);
    letter-spacing:-0.03em; -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column;
  }
  .card{flex:1;display:flex;flex-direction:column;padding:84px 76px}
  .card.cover{background:linear-gradient(165deg,#1b3057 0%,#0f1c33 100%);color:#fff}
  .card.cta{background:var(--bgsoft)}
  .brandline{display:flex;align-items:center;gap:14px;font-size:34px;font-weight:800;letter-spacing:-0.04em}
  .brandline .dot{color:var(--accent);font-size:40px;line-height:0.6}
  .cover .brandline{color:#fff}
  /* 한글은 자간을 넓히면 글자가 흩어져 보인다 — 라틴 기준 tracking을 쓰지 않는다 */
  .eyebrow{font-size:28px;font-weight:800;letter-spacing:.02em;color:var(--accent)}
  .hook{font-size:82px;line-height:1.22;font-weight:800;letter-spacing:-0.05em}
  .cover .hook{color:#fff}
  .subtitle{font-size:34px;color:var(--mute);font-weight:600;line-height:1.5}
  .cover .subtitle{color:#9fb2d4}
  .swipe{display:flex;align-items:center;gap:16px;font-size:30px;font-weight:700;color:#9fb2d4}
  .title{font-size:52px;font-weight:800;line-height:1.25;letter-spacing:-0.045em}
  .meta{font-size:26px;color:var(--mute);font-weight:600;line-height:1.5}
  ol{list-style:none;display:flex;flex-direction:column;gap:20px}
  li{display:grid;grid-template-columns:104px 1fr auto;align-items:center;gap:28px;
     border:2px solid var(--line);border-radius:28px;padding:28px 32px}
  li.top{border-color:color-mix(in srgb,var(--gold) 45%,var(--line))}
  .badge{width:96px;height:96px;border-radius:26px;display:flex;align-items:center;justify-content:center;
         font-size:44px;font-weight:800;background:var(--bgsoft);color:var(--soft);border:2px solid var(--line)}
  .badge.r1{background:linear-gradient(145deg,#f4d780,var(--gold));color:#4a3a10;border:none}
  .badge.r2{background:linear-gradient(145deg,#d7dde6,var(--silver));color:#2b3444;border:none}
  .badge.r3{background:linear-gradient(145deg,#d9a877,var(--bronze));color:#402713;border:none}
  .nm{font-size:40px;font-weight:700;line-height:1.25;overflow:hidden}
  .sb{font-size:26px;color:var(--soft);font-weight:600;margin-top:6px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px}
  .val{font-size:40px;font-weight:800;color:var(--brand);text-align:right;white-space:nowrap}
  .spacer{flex:1}
  .foot{font-size:28px;color:var(--mute);font-weight:600}
  .cta-big{font-size:64px;font-weight:800;line-height:1.3;letter-spacing:-0.045em}
  .url{font-size:44px;font-weight:800;color:var(--brand)}
  .pill{display:inline-block;background:color-mix(in srgb,var(--accent) 14%,transparent);
        color:var(--accent);font-size:28px;font-weight:800;padding:12px 26px;border-radius:999px}
</style></head><body><div class="card ${extraClass}">${inner}</div></body></html>`;
}

// ---------- slides ----------
function coverSlide(r, cat) {
  return slide(
    `<div class="brandline">모두랭킹<span class="dot">·</span></div>
     <div class="spacer"></div>
     <div class="eyebrow">${esc(cat.name)}</div>
     <h1 class="hook" style="margin:24px 0 32px">${esc(r.hook || r.title)}</h1>
     <p class="subtitle">${esc(r.title)}</p>
     <div class="spacer"></div>
     <div class="swipe">넘겨서 전체 순위 보기 <span style="font-size:40px">→</span></div>`,
    "cover"
  );
}

function listSlide(r, cat, items, from) {
  const rows = items
    .map((it, i) => {
      const n = from + i;
      const cls = n <= 3 ? ` r${n}` : "";
      return `<li class="${n <= 3 ? "top" : ""}">
        <span class="badge${cls}">${n}</span>
        <div><div class="nm">${esc(it.name)}</div>${it.sub ? `<div class="sb">${esc(it.sub)}</div>` : ""}</div>
        ${it.value ? `<div class="val">${esc(it.value)}</div>` : "<div></div>"}
      </li>`;
    })
    .join("");
  return slide(
    `<div class="eyebrow">${esc(cat.name)} · ${from}–${from + items.length - 1}위</div>
     <h2 class="title" style="margin:18px 0 12px">${esc(r.title)}</h2>
     <p class="meta" style="margin-bottom:34px">${esc(r.value_label || "")}</p>
     <ol>${rows}</ol>
     <div class="spacer"></div>
     <p class="foot">출처 · ${esc(r.source)}</p>`
  );
}

function ctaSlide(r) {
  return slide(
    `<div class="brandline">모두랭킹<span class="dot">·</span></div>
     <div class="spacer"></div>
     <span class="pill">검증된 데이터만</span>
     <h2 class="cta-big" style="margin:28px 0 22px">해설과 지난 주차 기록까지<br>사이트에서 전부 볼 수 있어요</h2>
     <p class="subtitle" style="margin-bottom:38px">${site.categories.length}개 카테고리 · 랭킹 ${rankings.length}개<br>모든 랭킹에 출처와 수집일을 표기합니다</p>
     <p class="url">www.${site.domain}</p>
     <div class="spacer"></div>
     <p class="foot">이 랭킹 · ${esc(r.source)} · ${esc(r.collected_date)} 기준</p>`,
    "cta"
  );
}

// ---------- caption ----------
// 문장 단위로 잘라 단어 중간에서 끊기는 것을 막는다.
const sentences = (s = "", n = 2) =>
  (s.match(/[^.!?]+[.!?]/g) || [s]).slice(0, n).join("").trim();

// 캡션은 첫 슬라이드 옆에 함께 보이므로 순위를 적으면 표지의 "넘겨서 보기"가
// 무력화된다 — 사이트 카드에서 '1위 OOO' 스포일러를 뺀 것과 같은 이유.
// analysis는 특정 항목을 거명하는 경우가 많아 쓰지 않고, 자료를 설명하는 intro를 쓴다.
function caption(r, cat) {
  const tags = [
    "모두랭킹", "랭킹", cat.name.replace(/[·\s]/g, ""), "순위",
    ...(r.slug.startsWith("world") || r.slug.startsWith("fx") ? ["세계순위", "통계"] : []),
    ...(cat.slug === "game" ? ["게임순위", "게임추천"] : []),
    ...(cat.slug === "music" ? ["음악차트", "노래추천"] : []),
    ...(cat.slug === "movie" ? ["넷플릭스", "영화추천"] : []),
    ...(cat.slug === "sports" ? ["스포츠", "야구"] : []),
    "정보", "꿀팁",
  ];
  return `${r.hook || r.title}

${r.title} — 순위는 이미지를 넘겨서 확인하세요 👉

${sentences(r.intro, 2)}

전체 순위와 해설, 지난 주차 기록까지 사이트에서 볼 수 있어요.

📊 출처 · ${r.source}
🗓 ${r.collected_date} 기준
🔗 www.${site.domain}/${r.slug}.html

${tags.map((t) => "#" + t).join(" ")}
`;
}

// ---------- write ----------
const targets = pick(process.argv.slice(2));
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const r of targets) {
  const cat = catBySlug[r.category];
  const items = r.items.slice(0, 10);
  const half = Math.ceil(items.length / 2);
  const slides = [
    coverSlide(r, cat),
    listSlide(r, cat, items.slice(0, half), 1),
    ...(items.length > half ? [listSlide(r, cat, items.slice(half), half + 1)] : []),
    ctaSlide(r),
  ];
  const files = slides.map((html, i) => {
    const name = `${r.slug}-${String(i + 1).padStart(2, "0")}.html`;
    writeFileSync(join(OUT, name), html, "utf8");
    return name;
  });
  writeFileSync(join(OUT, `${r.slug}.txt`), caption(r, cat), "utf8");
  manifest.push({ slug: r.slug, title: r.title, slides: files, caption: `${r.slug}.txt` });
  console.log(`  ${r.slug} — 슬라이드 ${files.length}장 + 캡션`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`social/ 에 ${targets.length}개 랭킹, 슬라이드 ${manifest.reduce((n, m) => n + m.slides.length, 0)}장 생성`);

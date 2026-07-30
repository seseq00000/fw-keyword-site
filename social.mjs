#!/usr/bin/env node
// 모두랭킹 Instagram carousel generator
// Usage:
//   node social.mjs                 # 오늘 추천 랭킹 자동 선정
//   node social.mjs <slug> [slug…]  # 특정 랭킹 지정
//
// 랭킹 JSON → 1080x1350 캐러셀 5장(HTML) + 캡션(.txt).
// HTML → JPEG 변환은 렌더러가 담당한다(.github/workflows/social.yml 의 Playwright).
// 사이트와 같은 팔레트를 쓰되, 헤드라인은 세리프로 대비를 준다.
//
// 슬라이드 순서는 아랫 순위 → 1위 방향이다. 표지에는 1위를 절대 노출하지 않는다.
//
// PEXELS_API_KEY 가 있으면 주제 사진을 배경으로 깔고, 없으면 카테고리별
// 그라디언트로 렌더한다. 사진 원본은 social/bg/ 에 두고 커밋하지 않는다
// (Pexels 라이선스가 원본 재배포를 금지한다).

import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const OUT = join(ROOT, "social");
const BG = join(OUT, "bg");

const site = JSON.parse(readFileSync(join(DATA, "site.json"), "utf8"));
const catBySlug = Object.fromEntries(site.categories.map((c) => [c.slug, c]));
const rankings = readdirSync(join(DATA, "rankings"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DATA, "rankings", f), "utf8")));

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- 카테고리별 그라운드 ----------
// 깊고 채도 있는 어두운 색. 사진이 없을 때 이 색이 화면을 지탱한다.
const GROUND = {
  game: ["#1b1038", "#0d0820"], music: ["#2a0f24", "#150713"],
  movie: ["#14161f", "#080a0f"], app: ["#0d1c30", "#060f1b"],
  book: ["#241708", "#120b04"], life: ["#1e1409", "#0f0a04"],
  sports: ["#0b2118", "#05110c"], econ: ["#121a24", "#080d13"],
  world: ["#06212c", "#031117"], fx: ["#151824", "#0a0c13"],
};
const PHOTO_Q = {
  game: "video game controller neon", music: "concert stage lights",
  movie: "cinema theater seats", app: "smartphone screen dark",
  book: "old books library", life: "food market night",
  sports: "stadium floodlights night", econ: "city skyline finance",
  world: "world map globe dark", fx: "bank vault gold currency",
};

// ---------- 값 파싱 ----------
// 한글 단위를 환산한다. 앵커하지 않고 첫 수치를 찾아 '약 6,481억', '금 1,231개',
// '.355' 같은 접두어·선행 소수점을 모두 흡수한다.
function parseValue(s) {
  if (s == null) return null;
  const t = String(s).replace(/[★,\s]/g, "");
  const m = t.match(/(\d*\.?\d+)조(\d*\.?\d+)?억?|(\d*\.?\d+)억|(\d*\.?\d+)만|(\d*\.?\d+)/);
  if (!m) return null;
  if (m[1]) return parseFloat(m[1]) * 1e12 + (m[2] ? parseFloat(m[2]) * 1e8 : 0);
  if (m[3]) return parseFloat(m[3]) * 1e8;
  if (m[4]) return parseFloat(m[4]) * 1e4;
  return parseFloat(m[5]);
}

// 막대는 10개가 전부 파싱되고 내림차순일 때만 켠다. 길이가 틀린 막대는
// 데이터 왜곡이므로, 애매하면 막대 없이 가는 편이 낫다.
function barScale(items) {
  const v = items.map((i) => parseValue(i.value));
  if (!v.every((x) => x !== null && x > 0)) return null;
  if (!v.every((x, i) => i === 0 || x <= v[i - 1] * 1.0001)) return null;
  const max = v[0];
  return (item) => (parseValue(item.value) / max) * 100;
}

// ---------- 배경 사진 (선택) ----------
async function fetchBackground(r) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const q = r.social_query || PHOTO_Q[r.category] || "abstract dark texture";
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=portrait&size=large`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const p = (await res.json()).photos?.[0];
    if (!p) return null;
    const img = await fetch(p.src.large2x);
    if (!img.ok) throw new Error(`img ${img.status}`);
    if (!existsSync(BG)) mkdirSync(BG, { recursive: true });
    writeFileSync(join(BG, `${r.slug}.jpg`), Buffer.from(await img.arrayBuffer()));
    return { file: `bg/${r.slug}.jpg`, credit: p.photographer };
  } catch (e) {
    console.log(`  (사진 건너뜀 ${r.slug}: ${e.message})`);
    return null;
  }
}

// ---------- 슬라이드 셸 ----------
const FONTS = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700;900&display=swap">`;

function slide(r, inner, opts = {}) {
  const [g1, g2] = GROUND[r.category] || GROUND.econ;
  const photo = opts.bg
    ? `background-image:url('${opts.bg}');background-size:cover;background-position:center;`
    : "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">${FONTS}
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--accent:#ff8b6b;--gold:#e8c777}
  html,body{width:1080px;height:1350px;overflow:hidden}
  body{
    font-family:"Pretendard Variable",Pretendard,system-ui,sans-serif;
    color:#fff; letter-spacing:-0.035em; -webkit-font-smoothing:antialiased;
    background:linear-gradient(160deg,${g1} 0%,${g2} 100%);
    /* 한글은 기본적으로 어느 글자에서나 줄이 바뀐다 — 이걸 두면 '매일'이
       '매 / 일'로 쪼개진다. 어절 단위로만 끊기게 강제한다. */
    word-break:keep-all;
  }
  .bg{position:absolute;inset:0;${photo}}
  /* 사진을 전면으로 덮지 않고 아래쪽에만 스크림을 깐다 — 사진은 살고 글자는 선명해진다 */
  .scrim{position:absolute;inset:0;
    background:linear-gradient(180deg,
      rgba(0,0,0,.30) 0%, rgba(0,0,0,.10) 26%,
      rgba(0,0,0,.72) 62%, rgba(0,0,0,.92) 100%);}
  .tint{position:absolute;inset:0;background:linear-gradient(160deg,${g1}cc 0%,${g2}e6 100%)}
  .card{position:absolute;inset:0;display:flex;flex-direction:column;padding:84px 76px}
  .serif{font-family:"Noto Serif KR",serif;letter-spacing:-0.02em}
  .spacer{flex:1}

  .eyebrow{font-size:27px;font-weight:800;color:var(--accent);letter-spacing:.01em}
  .hook{font-weight:900;line-height:1.18;text-wrap:balance}
  /* 강조 구절은 통째로 유지한다 — '3분의 1'이 줄바꿈으로 갈리면 강조가 무너진다 */
  .hook em{font-style:normal;color:var(--gold);white-space:nowrap}
  .sub{font-size:32px;color:rgba(255,255,255,.62);font-weight:600;line-height:1.5;text-wrap:balance}
  .swipe{font-size:29px;font-weight:700;color:rgba(255,255,255,.55)}

  .title{font-size:47px;font-weight:700;line-height:1.28;text-wrap:balance}
  .meta{font-size:25px;color:rgba(255,255,255,.45);font-weight:600}

  ol{list-style:none;display:flex;flex-direction:column}
  li{position:relative;display:grid;grid-template-columns:118px 1fr auto;align-items:center;
     gap:24px;padding:26px 8px 30px;border-top:1px solid rgba(255,255,255,.11)}
  li:last-child{border-bottom:1px solid rgba(255,255,255,.11)}
  /* 값에 비례하는 막대. 1위 대비 비율이라 하위권은 실제로 짧다 —
     행 배경을 채우면 오류처럼 보이므로, 행 아래 얇은 트랙으로 둔다.
     트랙이 보이니 짧은 막대도 '작은 값'으로 정확히 읽힌다. */
  .track{position:absolute;left:8px;right:8px;bottom:12px;height:5px;border-radius:3px;
         background:rgba(255,255,255,.08)}
  .track i{display:block;height:100%;border-radius:3px;
           background:linear-gradient(90deg,var(--gold),rgba(232,199,119,.45))}
  .rk{font-size:80px;font-weight:500;color:rgba(255,255,255,.42);text-align:left;line-height:1}
  .nm{font-size:38px;font-weight:700;line-height:1.24;
      overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .sb{font-size:23px;color:rgba(255,255,255,.48);font-weight:600;margin-top:5px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:470px}
  .val{font-size:37px;font-weight:800;text-align:right;white-space:nowrap;
       font-variant-numeric:tabular-nums;color:#fff}
  .foot{font-size:24px;color:rgba(255,255,255,.40);font-weight:600}

  .win-lab{font-size:30px;font-weight:800;color:var(--gold);letter-spacing:.02em}
  .win-no{font-size:300px;font-weight:900;line-height:.82;color:rgba(255,255,255,.14)}
  .win-nm{font-size:88px;font-weight:900;line-height:1.15;text-wrap:balance}
  .win-val{font-size:64px;font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums}
  .win-sb{font-size:29px;color:rgba(255,255,255,.58);font-weight:600}

  .cta-1{font-size:88px;font-weight:900;line-height:1.2;text-wrap:balance}
  .cta-2{font-size:52px;font-weight:800;color:var(--gold);line-height:1.3;margin-top:18px}
  .cta-why{font-size:31px;color:rgba(255,255,255,.62);font-weight:600;line-height:1.55}
  .cta-tr{font-size:25px;color:rgba(255,255,255,.40);font-weight:600}
  .mark{font-size:34px;font-weight:800}
  .url{font-size:33px;color:var(--gold);font-weight:700;margin-top:6px}
</style></head><body>
${opts.bg ? `<div class="bg"></div><div class="scrim"></div>` : `<div class="tint"></div>`}
<div class="card">${inner}</div></body></html>`;
}

// 후크는 길이에 따라 크기를 낮춘다. 국내 정보성 게시물 기준으로 크게 잡았다.
const hookSize = (s) => (s.length <= 22 ? 132 : s.length <= 34 ? 116 : s.length <= 46 ? 96 : 84);

// hook_em 은 반드시 hook 의 부분 문자열이어야 한다. 어느 구절을 강조할지
// 코드가 추측하지 않는다 — 필드가 없으면 강조 없이 렌더한다.
function hookHtml(r) {
  const h = r.hook || r.title;
  if (r.hook_em && h.includes(r.hook_em)) {
    const i = h.indexOf(r.hook_em);
    return esc(h.slice(0, i)) + "<em>" + esc(r.hook_em) + "</em>" + esc(h.slice(i + r.hook_em.length));
  }
  return esc(h);
}

// ---------- 슬라이드 ----------
function coverSlide(r, cat, bg) {
  const h = r.hook || r.title;
  return slide(
    r,
    `<div class="spacer"></div>
     <div class="eyebrow">${esc(cat.name)}</div>
     <h1 class="hook serif" style="font-size:${hookSize(h)}px;margin:22px 0 30px">${hookHtml(r)}</h1>
     <p class="sub">${esc(r.title)}</p>
     <div class="spacer"></div>
     <div class="swipe">넘겨서 확인하기 →</div>`,
    { bg }
  );
}

function listSlide(r, cat, items, bar) {
  const rows = items
    .map((it) => {
      const w = bar ? bar(it) : 0;
      return `<li>
        ${bar ? `<span class="track"><i style="width:${w.toFixed(1)}%"></i></span>` : ""}
        <span class="rk serif">${it.__rank}</span>
        <div><div class="nm">${esc(it.name)}</div>${it.sub ? `<div class="sb">${esc(it.sub)}</div>` : ""}</div>
        ${it.value ? `<div class="val">${esc(it.value)}</div>` : "<div></div>"}
      </li>`;
    })
    .join("");
  const hi = items[0].__rank, lo = items[items.length - 1].__rank;
  return slide(
    r,
    `<div class="eyebrow">${esc(cat.name)} · ${hi}위 → ${lo}위</div>
     <h2 class="title serif" style="margin:16px 0 8px">${esc(r.title)}</h2>
     <p class="meta" style="margin-bottom:26px">${esc(r.value_label || "")}</p>
     <ol>${rows}</ol>
     <div class="spacer"></div>
     <p class="foot">출처 · ${esc(r.source)}</p>`,
    { bg: r.__bg }
  );
}

function winnerSlide(r, cat, top) {
  return slide(
    r,
    // 거대한 숫자 1이 이미 순위를 말하므로 '1위' 라벨은 중복이다 — 제거했다.
    `<div class="eyebrow">${esc(cat.name)}</div>
     <div class="spacer"></div>
     <div class="win-no serif">1</div>
     <div class="win-nm serif" style="margin-top:14px">${esc(top.name)}</div>
     ${top.sub ? `<p class="win-sb" style="margin-top:16px">${esc(top.sub)}</p>` : ""}
     ${top.value ? `<p class="win-val" style="margin-top:22px">${esc(top.value)}</p>` : ""}
     <div class="spacer"></div>
     <p class="foot">${esc(r.source)} · ${esc(r.collected_date)} 기준</p>`,
    { bg: r.__bg }
  );
}

function ctaSlide(r) {
  const autos = rankings.filter((x) => x.refresh).length;
  return slide(
    r,
    `<div class="spacer" style="flex:1.25"></div>
     <h2 class="cta-1 serif">이런 랭킹, 매일 올라옵니다</h2>
     <p class="cta-2">팔로우하고 놓치지 마세요</p>
     <p class="cta-why" style="margin-top:40px">${site.categories.length}개 카테고리 · 랭킹 ${rankings.length}개<br>${autos}개는 매일 자동으로 갱신됩니다</p>
     <p class="cta-tr" style="margin-top:20px">모든 랭킹에 출처와 수집일을 표기합니다</p>
     <div class="spacer"></div>
     <p class="mark">모두랭킹</p>
     <p class="url">www.${site.domain}</p>`,
    { bg: r.__bg }
  );
}

// ---------- 캡션 ----------
const sentences = (s = "", n = 2) =>
  (s.match(/[^.!?]+[.!?]/g) || [s]).slice(0, n).join("").trim();

// 캡션은 첫 슬라이드 옆에 함께 보이므로 순위를 적으면 표지의 "넘겨서 확인하기"가
// 무력화된다. analysis 는 특정 항목을 거명하는 경우가 많아 쓰지 않고 intro 를 쓴다.
function caption(r, cat, credit) {
  const tags = [
    "모두랭킹", "랭킹", cat.name.replace(/[·\s]/g, ""), "순위", "정보그램",
    ...(cat.slug === "game" ? ["게임순위"] : []),
    ...(cat.slug === "music" ? ["음악차트"] : []),
    ...(cat.slug === "movie" ? ["넷플릭스"] : []),
    ...(cat.slug === "sports" ? ["스포츠"] : []),
    ...(["world", "fx", "econ"].includes(cat.slug) ? ["세계순위", "통계"] : []),
    "정보", "꿀팁",
  ];
  return `${r.hook || r.title}

${r.title} — 순위는 이미지를 넘겨서 확인하세요 👉

${sentences(r.intro, 2)}

📊 출처 · ${r.source}
🗓 ${r.collected_date} 기준
🔗 www.${site.domain}/${r.slug}.html
${credit ? `📷 배경 사진 · ${credit} (Pexels)\n` : ""}
이런 랭킹 매일 올라옵니다. 팔로우하면 놓치지 않아요 🔔

${tags.map((t) => "#" + t).join(" ")}
`;
}

// ---------- 선정 ----------
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

// ---------- 실행 ----------
const targets = pick(process.argv.slice(2));
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const r of targets) {
  const cat = catBySlug[r.category];
  const bgInfo = await fetchBackground(r);
  r.__bg = bgInfo?.file || null;

  // 상위 10개에 실제 순위를 붙이고 뒤집어 아랫 순위부터 올라가게 만든다.
  const items = r.items.slice(0, 10).map((it, i) => ({ ...it, __rank: i + 1 }));
  const bar = barScale(items);
  const desc = [...items].reverse(); // 10 → 1
  const lower = desc.slice(0, desc.length - 5); // 10…6
  const upper = desc.slice(desc.length - 5, desc.length - 1); // 5…2
  const top = items[0];

  const slides = [
    coverSlide(r, cat, r.__bg),
    ...(lower.length ? [listSlide(r, cat, lower, bar)] : []),
    ...(upper.length ? [listSlide(r, cat, upper, bar)] : []),
    winnerSlide(r, cat, top),
    ctaSlide(r),
  ];

  const files = slides.map((html, i) => {
    const name = `${r.slug}-${String(i + 1).padStart(2, "0")}.html`;
    writeFileSync(join(OUT, name), html, "utf8");
    return name;
  });
  writeFileSync(join(OUT, `${r.slug}.txt`), caption(r, cat, bgInfo?.credit), "utf8");
  manifest.push({ slug: r.slug, title: r.title, slides: files, caption: `${r.slug}.txt`, bars: !!bar, photo: !!r.__bg });
  console.log(`  ${r.slug} — 슬라이드 ${files.length}장${bar ? " · 막대 ON" : ""}${r.__bg ? " · 사진" : ""}`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`social/ 에 ${targets.length}개 랭킹, 슬라이드 ${manifest.reduce((n, m) => n + m.slides.length, 0)}장 생성`);

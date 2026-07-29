#!/usr/bin/env node
// 모두랭킹 data refresher
// Usage: node refresh.mjs [--force-archive]
//
// For every ranking whose JSON carries a `refresh` block, re-fetches the source
// and rewrites `items` + `collected_date` in place. Once per ISO week it also
// freezes a snapshot into data/archive/<slug>/<year>-W<week>.json together with
// a computed diff, so past weeks stay readable forever and each archive page
// carries information the others don't.
//
// Exits non-zero on fetch/shape errors so CI fails loudly instead of committing
// a half-updated site.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RANK_DIR = join(ROOT, "data", "rankings");
const ARCHIVE_DIR = join(ROOT, "data", "archive");

const UA = "moduranking-databot/1.0 (https://www.moduranking.com; seseq00000@gmail.com)";
const FORCE_ARCHIVE = process.argv.includes("--force-archive");

// ---------- date helpers ----------
const todayISO = () => new Date().toISOString().slice(0, 10);

// ISO-8601 week: weeks start Monday, week 1 contains the first Thursday.
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}
const weekId = ({ year, week }) => `${year}-W${String(week).padStart(2, "0")}`;

// Apple's feed 504s now and then, so retry transient failures with backoff
// rather than failing an unattended CI run over a blip.
async function fetchRetry(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.ok) return r;
      last = new Error(`${r.status} ${r.statusText} for ${url}`);
      if (r.status < 500 && r.status !== 429) throw last; // 4xx won't fix itself
    } catch (e) {
      last = e;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  throw last;
}
const getJson = async (url) => (await fetchRetry(url)).json();
const getText = async (url) => (await fetchRetry(url)).text();

// Site-wide number style. Keeps one decimal below 1,000만 so figures like
// 127.6만 don't get flattened to 128만.
const man = (n) => {
  if (n >= 1e8) return (n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 2).replace(/\.?0+$/, "") + "억";
  const m = n / 1e4;
  if (m < 1000) return (Math.round(m * 10) / 10).toLocaleString("ko-KR") + "만";
  return Math.round(m).toLocaleString("ko-KR") + "만";
};

// Netflix ships season labels in English; the rest of the site is Korean.
const koSeason = (s) =>
  s
    .replace(/^Season (\d+)$/i, "시즌 $1")
    .replace(/^Limited Series$/i, "리미티드 시리즈")
    .replace(/^Part (\d+)$/i, "파트 $1");

// ---------- fetchers ----------
// Each returns items[] in the site's shape. Keep them small and dumb: one
// source quirk each, no cross-source cleverness.
const FETCHERS = {
  // Apple RSS Marketing Tools — apps / songs / albums / podcasts share a shape.
  async apple({ url, sub }) {
    const d = await getJson(url);
    const results = d?.feed?.results;
    if (!Array.isArray(results) || !results.length) throw new Error("apple feed: no results");
    return results.map((a) => {
      const genres = (a.genres || []).map((g) => g.name).filter((g) => !["팟캐스트", "음악"].includes(g));
      const parts = [a.artistName];
      if (sub === "genre" && genres.length) parts.push(genres[0]);
      const item = { name: a.name, sub: parts.filter(Boolean).join(" · ") };
      if (a.url) item.url = a.url.replace(/\?.*$/, "");
      return item;
    });
  },

  // Netflix official weekly Top 10 TSV.
  async netflix({ category, count = 10 }) {
    const tsv = await getText("https://top10.netflix.com/data/all-weeks-global.tsv");
    const [head, ...rows] = tsv.trim().split("\n");
    const cols = head.split("\t");
    const rec = rows.map((r) => Object.fromEntries(r.split("\t").map((v, i) => [cols[i], v])));
    const week = [...new Set(rec.map((r) => r.week))].sort().reverse()[0];
    const list = rec
      .filter((r) => r.week === week && r.category === category)
      .sort((a, b) => Number(a.weekly_rank) - Number(b.weekly_rank))
      .slice(0, count);
    if (!list.length) throw new Error(`netflix: no rows for ${category}`);
    return {
      week,
      items: list.map((r) => {
        // season_title is "<show_title>: <label>". Strip that exact prefix —
        // splitting on the first colon mangles shows whose own title contains
        // one ("The Ultimatum: Marry or Move On: Season 4").
        let raw = r.season_title && r.season_title !== "N/A" ? r.season_title : "";
        if (raw.startsWith(r.show_title + ": ")) raw = raw.slice(r.show_title.length + 2);
        const season = raw ? koSeason(raw) : "";
        const wks = Number(r.cumulative_weeks_in_top_10);
        return {
          name: r.show_title,
          sub: [season, wks ? `차트 ${wks}주차` : ""].filter(Boolean).join(" · "),
          value: man(Number(r.weekly_views)) + " 회",
        };
      }),
    };
  },

  // GitHub search, sorted by stars. One request per run stays well inside the
  // unauthenticated search limit.
  async github({ minStars = 100000, count = 10 }) {
    const d = await getJson(
      `https://api.github.com/search/repositories?q=stars:%3E${minStars}&sort=stars&order=desc&per_page=${count}`
    );
    if (!d?.items?.length) throw new Error("github: no items");
    // Cut descriptions at a word boundary — slicing mid-word ("the system design in")
    // reads like a bug.
    const short = (s = "", max = 72) => {
      const t = s.replace(/\s+/g, " ").trim();
      if (t.length <= max) return t;
      const cut = t.slice(0, max);
      return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "") + "…";
    };
    return d.items.map((r) => ({
      name: r.full_name,
      sub: [r.language, short(r.description)].filter(Boolean).join(" · "),
      value: "★ " + r.stargazers_count.toLocaleString("ko-KR"),
      url: r.html_url,
    }));
  },

  // Steam Korean storefront best-sellers. Editions are separate SKUs, so a
  // popular game legitimately appears more than once — that's the chart, not a bug.
  async steamstore({ count = 10 }) {
    const d = await getJson("https://store.steampowered.com/api/featuredcategories?cc=kr&l=korean");
    const items = (d?.top_sellers?.items || []).slice(0, count);
    if (!items.length) throw new Error("steamstore: no top_sellers");
    return items.map((x) => {
      const won = (n) => (n / 100).toLocaleString("ko-KR") + "원";
      const bits = [];
      if (x.discount_percent) bits.push(`${x.discount_percent}% 할인 (정가 ${won(x.original_price)})`);
      else if (x.final_price === 0) bits.push("무료");
      return {
        name: x.name,
        sub: bits.join(" · "),
        value: x.final_price === 0 ? "무료" : won(x.final_price),
        url: `https://store.steampowered.com/app/${x.id}/`,
      };
    });
  },

  // Valve weekly most-played. Ranked by total playtime; peak concurrency is
  // shown in `sub` so the value column never looks out of order.
  async steam({ count = 10 }) {
    const d = await getJson("https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/");
    const ranks = (d?.response?.ranks || []).slice(0, count);
    if (!ranks.length) throw new Error("steam: no ranks");
    const items = [];
    for (const g of ranks) {
      let name = `appid ${g.appid}`;
      try {
        const dd = await getJson(`https://store.steampowered.com/api/appdetails?appids=${g.appid}&l=korean&filters=basic`);
        name = dd?.[g.appid]?.data?.name || name;
      } catch { /* keep the appid fallback rather than failing the whole run */ }
      const bits = [`최고 동시접속 ${man(g.peak_in_game)} 명`];
      if (g.last_week_rank && g.last_week_rank !== g.rank) bits.push(`직전 주 ${g.last_week_rank}위`);
      items.push({ name, sub: bits.join(" · ") });
      await new Promise((r) => setTimeout(r, 250));
    }
    return items;
  },
};

// ---------- diff ----------
// Produces the per-snapshot facts that make each archive page distinct.
function diff(prev, next) {
  if (!prev) return { first: true, lines: ["첫 기록입니다."] };
  const pi = new Map(prev.map((it, i) => [it.name, i + 1]));
  const ni = new Map(next.map((it, i) => [it.name, i + 1]));
  const entered = next.filter((it) => !pi.has(it.name)).map((it) => `${ni.get(it.name)}위 ${it.name}`);
  const left = prev.filter((it) => !ni.has(it.name)).map((it) => it.name);
  const risers = next
    .filter((it) => pi.has(it.name) && pi.get(it.name) - ni.get(it.name) >= 3)
    .map((it) => ({ name: it.name, from: pi.get(it.name), to: ni.get(it.name) }))
    .sort((a, b) => b.from - b.to - (a.from - a.to));

  const lines = [];
  const top = next[0]?.name;
  lines.push(prev[0]?.name === top ? `1위 ${top} — 자리 유지` : `1위 교체 — ${prev[0]?.name} → ${top}`);
  if (entered.length) lines.push(`신규 진입 ${entered.length}개: ${entered.slice(0, 5).join(", ")}`);
  if (left.length) lines.push(`순위 이탈 ${left.length}개: ${left.slice(0, 5).join(", ")}`);
  if (risers.length) {
    const r = risers[0];
    lines.push(`최대 상승 — ${r.name} (${r.from}위 → ${r.to}위)`);
  }
  if (!entered.length && !left.length && !risers.length) lines.push("순위 변동이 크지 않았습니다.");
  return { first: false, lines };
}

// ---------- main ----------
const wk = isoWeek();
const wid = weekId(wk);
const today = todayISO();

const files = readdirSync(RANK_DIR).filter((f) => f.endsWith(".json"));
let refreshed = 0, archived = 0, unchanged = 0;
const report = [];

// Phase 1 — fetch everything first. A failure here aborts before anything is
// written, so the repo never ends up half-updated.
const pending = [];
for (const f of files) {
  const path = join(RANK_DIR, f);
  const r = JSON.parse(readFileSync(path, "utf8"));
  if (!r.refresh) continue;

  const fetcher = FETCHERS[r.refresh.type];
  if (!fetcher) throw new Error(`${r.slug}: unknown refresh type "${r.refresh.type}"`);

  const out = await fetcher(r.refresh);
  const items = Array.isArray(out) ? out : out.items;
  if (!items?.length) throw new Error(`${r.slug}: fetcher returned nothing`);
  if (items.length < Math.ceil(r.items.length * 0.8)) {
    throw new Error(`${r.slug}: got ${items.length} items, expected ~${r.items.length} — refusing to shrink the ranking`);
  }
  pending.push({ path, r, out, items });
}

// Phase 2 — write.
for (const { path, r, out, items } of pending) {
  const before = r.items;
  const same = JSON.stringify(before) === JSON.stringify(items);

  // Archive the *outgoing* snapshot once per ISO week, before overwriting.
  const dir = join(ARCHIVE_DIR, r.slug);
  const snapPath = join(dir, `${wid}.json`);
  const weekAlreadyArchived = existsSync(snapPath);

  if (!weekAlreadyArchived || FORCE_ARCHIVE) {
    // Compare against the newest *earlier* week — never this week's own file,
    // which would otherwise make a re-run diff a snapshot against itself.
    const prevSnap = existsSync(dir)
      ? readdirSync(dir)
          .filter((x) => x.endsWith(".json") && x !== `${wid}.json`)
          .sort()
          .reverse()[0]
      : null;
    const prevItems = prevSnap ? JSON.parse(readFileSync(join(dir, prevSnap), "utf8")).items : null;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      snapPath,
      JSON.stringify(
        {
          slug: r.slug,
          week_id: wid,
          year: wk.year,
          week: wk.week,
          period: out.week ? `${out.week} 주간` : null,
          collected_date: today,
          items,
          changes: diff(prevItems, items).lines,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    archived++;
    report.push(`  archive ${r.slug} → ${wid}`);
  }

  if (same) {
    unchanged++;
    report.push(`  = ${r.slug} (변동 없음)`);
    continue;
  }

  r.items = items;
  r.collected_date = today;
  writeFileSync(path, JSON.stringify(r, null, 2) + "\n", "utf8");
  refreshed++;
  report.push(`  ↻ ${r.slug} — 1위 ${items[0].name}`);
}

console.log(`refresh ${today} (${wid})`);
report.forEach((l) => console.log(l));
console.log(`갱신 ${refreshed} · 아카이브 ${archived} · 변동없음 ${unchanged}`);

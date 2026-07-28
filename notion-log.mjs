#!/usr/bin/env node
// 모두랭킹 → Notion 작업 로그 기록기
// 사용법: node notion-log.mjs <entry.json>
//   또는: cat entry.json | node notion-log.mjs -
//
// 인증: .notion-token (Bearer 토큰), .notion.json ({page_id, notion_version})
//   두 파일 모두 .gitignore 처리되어 저장소에 커밋되지 않습니다.
//
// entry.json 형식:
// {
//   "date": "2026-07-28",              // 없으면 오늘 날짜
//   "title": "사이트 전면 재구축",
//   "summary": "한두 문장 요약",
//   "sections": [
//     { "heading": "변경 파일", "items": ["build.mjs 추가", "..."] },
//     { "heading": "추가된 랭킹", "items": ["게임 · 인기 게임 순위 (출처 게임메카)", "..."] }
//   ],
//   "commit": "b4999d1",               // 선택
//   "links": ["https://www.moduranking.com"]  // 선택
// }

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TOKEN = readFileSync(join(ROOT, ".notion-token"), "utf8").trim();
const cfg = JSON.parse(readFileSync(join(ROOT, ".notion.json"), "utf8"));
const NOTION_VERSION = cfg.notion_version || "2022-06-28";
const PAGE_ID = cfg.page_id;

// --- read entry ---
const arg = process.argv[2];
if (!arg) {
  console.error("usage: node notion-log.mjs <entry.json>  (or - for stdin)");
  process.exit(1);
}
let raw;
if (arg === "-") raw = readFileSync(0, "utf8");
else raw = readFileSync(arg, "utf8");
const entry = JSON.parse(raw);
const date = entry.date || new Date().toISOString().slice(0, 10);

// --- block helpers ---
const clip = (s) => String(s ?? "").slice(0, 1900);
const rt = (content, opts = {}) => ({ type: "text", text: { content: clip(content), link: opts.link ? { url: opts.link } : null }, annotations: opts.annotations });
const h2 = (t) => ({ object: "block", type: "heading_2", heading_2: { rich_text: [rt(t)] } });
const h3 = (t) => ({ object: "block", type: "heading_3", heading_3: { rich_text: [rt(t)] } });
const para = (t) => ({ object: "block", type: "paragraph", paragraph: { rich_text: t ? [rt(t)] : [] } });
const bullet = (t) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [rt(t)] } });
const divider = () => ({ object: "block", type: "divider", divider: {} });

// --- build blocks ---
const blocks = [];
blocks.push(divider());
blocks.push(h2(`${date} · ${entry.title || "작업 로그"}`));
if (entry.summary) blocks.push(para(entry.summary));
for (const sec of entry.sections || []) {
  if (sec.heading) blocks.push(h3(sec.heading));
  for (const it of sec.items || []) blocks.push(bullet(it));
}
const footer = [];
if (entry.commit) footer.push(`commit ${entry.commit}`);
for (const l of entry.links || []) footer.push(l);
if (footer.length) {
  blocks.push({
    object: "block",
    type: "callout",
    callout: { icon: { type: "emoji", emoji: "🔗" }, rich_text: [rt(footer.join("  ·  "))] },
  });
}

// Notion allows max 100 children per append call
async function appendChunk(children) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ children }),
  });
  const j = await res.json();
  if (!res.ok || j.object === "error") {
    throw new Error(`Notion API ${j.status || res.status} ${j.code || ""}: ${j.message || JSON.stringify(j)}`);
  }
  return j;
}

try {
  for (let i = 0; i < blocks.length; i += 100) {
    await appendChunk(blocks.slice(i, i + 100));
  }
  console.log(`✓ Notion 기록 완료: "${date} · ${entry.title || "작업 로그"}" (${blocks.length} blocks)`);
} catch (e) {
  console.error("✗ 기록 실패:", e.message);
  process.exit(1);
}

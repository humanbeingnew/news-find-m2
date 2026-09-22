const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 NewsFilterPro-Web/1.0";

const TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_ARTICLES_TO_ANALYZE = 6;
const MAX_RESULTS = 15;
const MAX_RECOMMENDATIONS = 12;
const MIN_RECOMMENDATIONS = 2;

const KNOWN_NEWS_DOMAINS = new Set([
  "yna.co.kr","khan.co.kr","hani.co.kr","chosun.com","joongang.co.kr",
  "donga.com","kbs.co.kr","imbc.com","sbs.co.kr","ytn.co.kr","mk.co.kr",
  "sedaily.com","hankyung.com","etnews.com","zdnet.co.kr","sisajournal.com",
  "pressian.com","ohmynews.com","nocutnews.co.kr","seoul.co.kr","newsis.com",
  "heraldcorp.com","dt.co.kr"
]);

const SUSPICIOUS_WORDS = [
  "충격","경악","소름","대박","폭로","실화","충격적인","전부 공개",
  "정부가 숨긴","언론이 숨긴","절대 알려지지","100%","무조건","확실",
  "전 국민이 알아야","긴급","믿을 수 없는","삭제되기 전에","퍼뜨려주세요",
  "퍼뜨려 주세요"
];

const UNCERTAIN_WORDS = [
  "가능성","추정","주장","의혹","전망","예상","논란","관계자","소식통",
  "전해졌다","알려졌다"
];

const EVIDENCE_WORDS = [
  "자료","통계","보고서","연구","논문","조사","발표","원문","공식",
  "기자회견","공시","법원","판결","근거"
];

const STOPWORDS = new Set([
  "그리고","하지만","대한","관련","통해","이번","것으로","있다","했다",
  "하는","에서","으로","이후","대해","지난","뉴스","기사","속보","단독"
]);

function cleanText(text) {
  return decodeHtml(text || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function sameDomain(a, b) {
  const da = domainOf(a), db = domainOf(b);
  return !!(da && db && (da === db || da.endsWith("." + db) || db.endsWith("." + da)));
}

function normalizeTitle(title) {
  return new Set(
    (title || "").toLowerCase()
      .replace(/[\[\](){}<>"'“”‘’.,!?/:;|·…~\-_=+]/g, " ")
      .match(/[가-힣A-Za-z0-9]{2,}/g)?.filter(w => !STOPWORDS.has(w)) || []
  );
}

function titleSimilarity(a, b) {
  const sa = normalizeTitle(a), sb = normalizeTitle(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / Math.max(1, new Set([...sa, ...sb]).size);
}

function parseDate(s) {
  const t = Date.parse(s || "");
  return Number.isNaN(t) ? 0 : t;
}

function decodeXml(s) {
  return decodeHtml(s);
}

function tagValue(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? cleanText(m[1]) : "";
}

function sourceValue(block) {
  const m = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
  if (!m) return { name: "", url: "" };
  const attr = m[1].match(/\burl\s*=\s*["']([^"']+)["']/i);
  return { name: cleanText(m[2]), url: attr ? decodeXml(attr[1]) : "" };
}

function parseRss(xml) {
  const articles = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const src = sourceValue(item);
    articles.push({
      title: tagValue(item, "title"),
      link: tagValue(item, "link"),
      source: src.name,
      source_url: src.url,
      published: tagValue(item, "pubDate"),
      description: tagValue(item, "description"),
      final_url: "",
      page_title: "",
      page_text: "",
      canonical_url: "",
      fetch_status: "대기 중",
      score: 0,
      label: "",
      reasons: [],
      verification: []
    });
  }
  return articles;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...(options.headers || {}) }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response, maxBytes = MAX_PAGE_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) break;
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const n = Math.min(c.byteLength, merged.length - offset);
    merged.set(c.subarray(0, n), offset);
    offset += n;
    if (offset >= merged.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

async function resolveUrl(url) {
  if (!url) return { url: "", status: "URL 없음" };
  try {
    const r = await fetchWithTimeout(url, { redirect: "follow" }, 6000);
    return { url: r.url || url, status: r.ok ? "직접 접속 성공" : `HTTP ${r.status}` };
  } catch {
    return { url, status: "원본 링크 유지" };
  }
}

function extractMeta(html, key) {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const p = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${safe}["'][^>]+content\\s*=\\s*["']([\\s\\S]*?)["']`,
    "i"
  );
  const m = html.match(p);
  return m ? cleanText(m[1]) : "";
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([\s\S]*?)["']/i);
  return m ? decodeHtml(m[1].trim()) : "";
}

function extractPageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? cleanText(m[1]) : "";
}

function extractArticleText(html) {
  const blocks = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .map(m => cleanText(m[1])).filter(t => t.length >= 300);
  if (blocks.length) return blocks.sort((a,b) => b.length-a.length)[0].slice(0,12000);

  const ps = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => cleanText(m[1])).filter(t => t.length >= 30);
  if (ps.length) return ps.join(" ").slice(0,12000);

  return cleanText(html).slice(0,12000);
}

async function fetchArticlePage(article) {
  article.fetch_status = "원문 접속 시도 중";
  try {
    const r = await fetchWithTimeout(article.link, { redirect: "follow" });
    article.final_url = r.url || article.link;
    const type = r.headers.get("content-type") || "";
    if (!type.toLowerCase().includes("text/html") && !article.final_url.endsWith(".html") && !article.final_url.endsWith("/")) {
      article.fetch_status = "HTML 페이지가 아님";
      return;
    }
    const html = await readLimitedText(r);
    article.page_title = extractPageTitle(html);
    article.canonical_url = extractCanonical(html);
    article.page_text = extractArticleText(html);
    article.fetch_status = article.page_text ? "원문 일부 분석 성공" : "본문 추출 실패";
  } catch (e) {
    article.final_url = article.link;
    article.fetch_status = `원문 접속 실패: ${e.name || "Error"}`;
  }
}

function crossCheck(articles) {
  for (const article of articles) {
    const similar = [];
    for (const other of articles) {
      if (other === article) continue;
      const sim = titleSimilarity(article.title, other.title);
      if (sim >= 0.35) similar.push({ sim, other });
    }
    const uniqueSources = new Set(
      similar.map(x => x.other.source || domainOf(x.other.final_url || x.other.link)).filter(Boolean)
    );
    if (uniqueSources.size >= 2) {
      article.verification.push(`비슷한 내용의 다른 출처 ${uniqueSources.size}곳 이상 발견`);
    } else if (!similar.length) {
      article.verification.push("검색 결과 안에서 비슷한 제목의 다른 보도를 찾기 어려움");
    }
  }
}

function scoreArticle(article) {
  let score = 0, reasons = [];
  const finalUrl = article.final_url || article.link;
  const domain = domainOf(finalUrl);
  const text = `${article.title} ${article.description} ${article.page_title} ${article.page_text}`.toLowerCase();

  if (!article.source && !domain) {
    score += 25; reasons.push("출처를 확인하기 어려움");
  } else if (domain && ![...KNOWN_NEWS_DOMAINS].some(d => domain === d || domain.endsWith("." + d))) {
    score += 4; reasons.push("출처 도메인을 추가 확인할 필요가 있음");
  }

  const originalDomain = domainOf(article.link);
  if (originalDomain === "news.google.com" && domain === originalDomain) {
    score += 3; reasons.push("Google News 중간 링크에서 실제 기사 주소를 확인하지 못함");
  }

  const hits = SUSPICIOUS_WORDS.filter(w => text.includes(w.toLowerCase()));
  if (hits.length) {
    score += Math.min(28, hits.length * 5);
    reasons.push("자극적/선동적 표현: " + hits.slice(0,5).join(", "));
  }

  if (["100%","무조건","확실히","절대"].some(x => text.includes(x))) {
    score += 8; reasons.push("지나치게 단정적인 표현");
  }

  const uncertainHits = UNCERTAIN_WORDS.filter(w => text.includes(w));
  if (uncertainHits.length) reasons.push("주장/추정 표현 포함: " + uncertainHits.slice(0,3).join(", "));

  if (article.fetch_status.startsWith("원문 접속 실패") || article.fetch_status === "HTML 페이지가 아님") {
    score += 5; reasons.push("원문을 직접 분석하지 못함");
  } else if (article.fetch_status === "본문 추출 실패") {
    score += 3; reasons.push("원문 페이지는 확인했지만 본문 분석이 제한됨");
  }

  if (article.page_text) {
    const evidenceHits = EVIDENCE_WORDS.filter(w => article.page_text.includes(w));
    if (evidenceHits.length) {
      article.verification.push("본문에서 근거/자료 관련 표현 발견: " + evidenceHits.slice(0,4).join(", "));
    } else {
      article.verification.push("본문에서 명확한 근거 관련 표현을 많이 찾지 못함");
    }
  }

  if (!parseDate(article.published)) {
    score += 5; reasons.push("게시 날짜를 확인하기 어려움");
  }

  article.score = score;
  article.label = score >= 30 ? "🔴 검증 우선" : score >= 14 ? "🟡 주의" : "🟢 비교적 낮은 위험";
  article.reasons = reasons;
}

function deduplicate(articles) {
  const seen = new Set(), result = [];
  for (const a of articles) {
    const raw = a.canonical_url || a.final_url || a.link;
    try {
      const u = new URL(raw);
      u.hash = ""; u.hostname = u.hostname.toLowerCase(); u.pathname = u.pathname.replace(/\/+$/, "");
      const key = u.toString().toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); result.push(a); }
    } catch {
      if (raw && !seen.has(raw)) { seen.add(raw); result.push(a); }
    }
  }
  return result;
}

async function analyze(articles, onArticle) {
  const targets = articles.slice(0, MAX_ARTICLES_TO_ANALYZE);
  let cursor = 0;
  const workers = Math.min(4, targets.length);

  // 기사 하나의 원문 분석이 끝날 때마다 즉시 결과를 전달한다.
  // 따라서 느린 기사 때문에 전체 검색 결과 표시가 막히지 않는다.
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= targets.length) return;
      const article = targets[i];
      await fetchArticlePage(article);
      scoreArticle(article);
      if (onArticle) await onArticle(article);
    }
  }

  await Promise.all(Array.from({length: workers}, worker));
  for (const a of articles) scoreArticle(a);
  crossCheck(articles);
  return articles.sort((a,b) => b.score - a.score || parseDate(b.published) - parseDate(a.published)).slice(0, MAX_RESULTS);
}

async function searchNews(keyword) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
  // Google News RSS는 일시적으로 429/5xx를 반환할 수 있어 짧게 재시도한다.
  // 각 재시도 사이에 대기해 순간적인 rate limit/503을 흡수한다.
  const delays = [0, 700, 1600, 3000];
  let lastStatus = 0;
  let lastError = null;

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    try {
      const r = await fetchWithTimeout(url, {
        redirect: "follow",
        headers: {
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
          "Cache-Control": "no-cache"
        }
      }, 7000);
      lastStatus = r.status;
      if (r.ok) {
        const xml = await r.text();
        return parseRss(xml);
      }
      if (![429, 500, 502, 503, 504].includes(r.status)) {
        throw new Error(`Google News HTTP ${r.status}`);
      }
    } catch (e) {
      lastError = e;
      if (e?.message?.startsWith("Google News HTTP ") && ![429,500,502,503,504].includes(lastStatus)) throw e;
    }
  }

  if (lastStatus) throw new Error(`Google News HTTP ${lastStatus} (재시도 후에도 응답하지 않음)`);
  throw new Error(`Google News 연결 실패: ${lastError?.name || "Error"}`);
}


function recommendationQueries() {
  return [
    "주요 뉴스",
    "오늘 뉴스",
    "한국 주요 뉴스",
    "경제 뉴스",
    "과학 기술 뉴스",
    "사회 뉴스"
  ];
}

function recommendationScore(article) {
  // 추천은 "사실성 순위"가 아니라 최신성 + 출처 다양성 + 분석 가능성을
  // 조합한 노출 우선순위다.
  const ageHours = Math.max(0, (Date.now() - parseDate(article.published)) / 3600000);
  const freshness = parseDate(article.published) ? Math.max(0, 48 - ageHours) : 0;
  const sourceBonus = article.source ? 8 : 0;
  const analysisBonus = article.page_text ? 5 : 0;
  const riskPenalty = Math.min(10, article.score || 0) * 0.15;
  return freshness + sourceBonus + analysisBonus - riskPenalty;
}

async function fetchRecommendations() {
  const queries = recommendationQueries();
  const settled = await Promise.allSettled(queries.map(q => searchNews(q)));
  let all = [];
  for (const r of settled) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  all = deduplicate(all);
  // 추천 화면은 모든 기사의 원문을 가져오지 않고 검색 결과 메타데이터를
  // 중심으로 빠르게 구성한다.
  for (const a of all) scoreArticle(a);
  all.sort((a,b) =>
    recommendationScore(b) - recommendationScore(a) ||
    parseDate(b.published) - parseDate(a.published)
  );

  const selected = [];
  const sourceCounts = new Map();

  for (const article of all) {
    const source = article.source || domainOf(article.link) || "unknown";
    const count = sourceCounts.get(source) || 0;
    if (count >= 3) continue;
    sourceCounts.set(source, count + 1);
    selected.push(article);
    if (selected.length >= MAX_RECOMMENDATIONS) break;
  }

  // 출처 다양성 제한 때문에 2개 미만이 되면, 최소 2개가 가능할 경우
  // 제한을 완화해 추천 뉴스가 비어 보이지 않도록 한다.
  if (selected.length < MIN_RECOMMENDATIONS) {
    for (const article of all) {
      if (selected.includes(article)) continue;
      selected.push(article);
      if (selected.length >= Math.min(MIN_RECOMMENDATIONS, MAX_RECOMMENDATIONS)) break;
    }
  }

  // 위 검색들이 일시적으로 모두 실패한 경우 한 번 더 단순한 뉴스 검색으로 보완한다.
  if (selected.length < MIN_RECOMMENDATIONS) {
    try {
      const fallback = deduplicate(await searchNews("뉴스"));
      for (const article of fallback) {
        if (selected.some(x => (x.link || x.title) === (article.link || article.title))) continue;
        selected.push(article);
        if (selected.length >= Math.min(MIN_RECOMMENDATIONS, MAX_RECOMMENDATIONS)) break;
      }
    } catch {}
  }

  return selected.slice(0, MAX_RECOMMENDATIONS);
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" }
  });
}

function corsResponse(response) {
  const h = new Headers(response.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  h.set("access-control-allow-headers", "Content-Type");
  return new Response(response.body, { status: response.status, headers: h });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return corsResponse(new Response(null, { status: 204 }));

    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "NEWS FILTER PRO 2.1 Web", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/recommendations") {
      try {
        const articles = await fetchRecommendations();
        return json({
          count: articles.length,
          notice: "추천 순서는 최신성, 출처 다양성, 분석 가능성 등을 이용한 노출 우선순위이며 사실 여부나 가짜뉴스 확률을 의미하지 않습니다.",
          articles
        });
      } catch (e) {
        return json({ error: `추천 뉴스 생성 중 오류: ${e.message || e.name || "알 수 없는 오류"}` }, 502);
      }
    }

    if (url.pathname === "/api/search") {
      const keyword = (url.searchParams.get("q") || "").trim();
      if (!keyword) return json({ error: "검색어를 입력해주세요." }, 400);

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (payload) => controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
          try {
            let articles = await searchNews(keyword);
            articles = deduplicate(articles);

            if (!articles.length) {
              send({ type: "done", keyword, count: 0, analyzed: 0, articles: [] });
              controller.close();
              return;
            }

            send({
              type: "start",
              keyword,
              count: articles.length,
              analyzeTarget: Math.min(MAX_ARTICLES_TO_ANALYZE, articles.length),
              notice: "원문 분석이 끝나는 기사부터 순서대로 표시합니다."
            });

            let completed = 0;
            const finalArticles = await analyze(articles, async (article) => {
              completed += 1;
              send({
                type: "article",
                completed,
                total: Math.min(MAX_ARTICLES_TO_ANALYZE, articles.length),
                article
              });
            });

            send({
              type: "done",
              keyword,
              count: finalArticles.length,
              analyzed: Math.min(MAX_ARTICLES_TO_ANALYZE, articles.length),
              notice: "점수는 가짜뉴스 확률이 아니라 추가 검증이 필요한 정도를 나타내는 보조 신호입니다.",
              articles: finalArticles
            });
            controller.close();
          } catch (e) {
            send({ error: `검색/분석 중 오류: ${e.message || e.name || "알 수 없는 오류"}` });
            controller.close();
          }
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "x-accel-buffering": "no"
        }
      });
    }

    return corsResponse(await env.ASSETS.fetch(request));
  }
};

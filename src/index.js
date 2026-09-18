const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "Chrome/120 Safari/537.36 NewsFilterPro/2.1";

const TIMEOUT_MS = 6000;
const MAX_ARTICLES_TO_ANALYZE = 12;
const MAX_PAGE_CHARS = 12000;

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

async function fetchWithTimeout(url, init = {}, timeout = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, ...(init.headers || {}) }
    });
  } finally {
    clearTimeout(timer);
  }
}

function cleanText(text = "") {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlDecode(text = "") {
  const named = text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return named.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

function sameDomain(a, b) {
  const da = domainOf(a), db = domainOf(b);
  return !!da && !!db && (da === db || da.endsWith("." + db) || db.endsWith("." + da));
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? htmlDecode(m[1].trim()) : "";
}

function extractAllItems(xml) {
  const matches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return matches.map(item => {
    const sourceMatch = item.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    let sourceUrl = "";
    let source = "";
    if (sourceMatch) {
      source = htmlDecode(sourceMatch[2].trim());
      const u = sourceMatch[1].match(/\burl=["']([^"']+)["']/i);
      sourceUrl = u ? htmlDecode(u[1]) : "";
    }
    return {
      title: extractTag(item, "title"),
      link: extractTag(item, "link"),
      description: cleanText(extractTag(item, "description")),
      source,
      source_url: sourceUrl,
      published: extractTag(item, "pubDate")
    };
  }).filter(x => x.title && x.link);
}

async function fetchGoogleNewsRSS(keyword) {
  const url =
    "https://news.google.com/rss/search?q=" + encodeURIComponent(keyword) +
    "&hl=ko&gl=KR&ceid=KR:ko";
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  return extractAllItems(await res.text());
}

async function resolveUrl(url) {
  try {
    const res = await fetchWithTimeout(url, { redirect: "follow" }, 6000);
    return { url: res.url || url, status: "직접 접속 성공" };
  } catch {
    return { url, status: "원본 링크 유지" };
  }
}

function extractMeta(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content\\s*=\\s*["']([\\s\\S]*?)["']`,
    "i"
  );
  const m = html.match(re);
  return m ? cleanText(htmlDecode(m[1])) : "";
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([\s\S]*?)["']/i);
  return m ? htmlDecode(m[1].trim()) : "";
}

function extractPageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? cleanText(htmlDecode(m[1])) : "";
}

function extractArticleText(html) {
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .map(m => cleanText(htmlDecode(m[1])))
    .filter(x => x.length >= 300);
  if (articles.length) return articles.sort((a,b) => b.length-a.length)[0].slice(0, MAX_PAGE_CHARS);

  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => cleanText(htmlDecode(m[1])))
    .filter(x => x.length >= 30);
  if (paragraphs.length) return paragraphs.join(" ").slice(0, MAX_PAGE_CHARS);

  return cleanText(htmlDecode(html)).slice(0, MAX_PAGE_CHARS);
}

async function fetchArticlePage(article) {
  article.fetch_status = "원문 접속 시도 중";
  try {
    const res = await fetchWithTimeout(article.link);
    article.final_url = res.url || article.link;
    const type = res.headers.get("content-type") || "";
    if (!type.toLowerCase().includes("text/html")) {
      article.fetch_status = "HTML 페이지가 아님";
      return article;
    }
    const html = await res.text();
    article.page_title = extractPageTitle(html);
    article.canonical_url = extractCanonical(html);
    article.page_text = extractArticleText(html);
    article.fetch_status = article.page_text ? "원문 일부 분석 성공" : "본문 추출 실패";
  } catch (e) {
    article.final_url = article.link;
    article.fetch_status = `원문 접속 실패: ${e.name || "Error"}`;
  }
  return article;
}

function parseDate(s) {
  const t = Date.parse(s || "");
  return Number.isNaN(t) ? 0 : t;
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
  let intersection = 0;
  for (const w of sa) if (sb.has(w)) intersection++;
  return intersection / Math.max(1, new Set([...sa, ...sb]).size);
}

function crossCheck(articles) {
  for (const article of articles) {
    const similar = articles.filter(other =>
      other !== article && titleSimilarity(article.title, other.title) >= 0.35
    );
    const sources = new Set(
      similar.map(x => x.source || domainOf(x.final_url || x.link)).filter(Boolean)
    );
    if (sources.size >= 2)
      article.verification.push(`비슷한 내용의 다른 출처 ${sources.size}곳 이상 발견`);
    else if (!similar.length)
      article.verification.push("검색 결과 안에서 비슷한 제목의 다른 보도를 찾기 어려움");
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

  if (domainOf(article.link) === "news.google.com" && domain === "news.google.com") {
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

  const uncertain = UNCERTAIN_WORDS.filter(w => text.includes(w));
  if (uncertain.length) article.verification.push("주장/추정 표현 포함: " + uncertain.slice(0,3).join(", "));

  if (article.fetch_status.startsWith("원문 접속 실패")) {
    score += 5; reasons.push("원문을 직접 분석하지 못함");
  } else if (["본문 추출 실패","HTML 페이지가 아님"].includes(article.fetch_status)) {
    score += 3; reasons.push("원문 페이지는 확인했지만 본문 분석이 제한됨");
  }

  if (article.page_text) {
    const evidence = EVIDENCE_WORDS.filter(w => article.page_text.includes(w));
    article.verification.push(
      evidence.length
        ? "본문에서 근거/자료 관련 표현 발견: " + evidence.slice(0,4).join(", ")
        : "본문에서 명확한 근거 관련 표현을 많이 찾지 못함"
    );
  }

  if (!parseDate(article.published)) {
    score += 5; reasons.push("게시 날짜를 확인하기 어려움");
  }

  article.score = score;
  article.label = score >= 30 ? "🔴 검증 우선" : score >= 14 ? "🟡 주의" : "🟢 비교적 낮은 위험";
  article.reasons = reasons;
  return article;
}

function deduplicate(articles) {
  const seen = new Set(), result = [];
  for (const article of articles) {
    let raw = article.canonical_url || article.final_url || article.link;
    try {
      const u = new URL(raw);
      u.hash = "";
      u.pathname = u.pathname.replace(/\/+$/, "");
      raw = u.toString();
    } catch {}
    const key = raw.toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push(article); }
  }
  return result;
}

async function analyzeArticles(articles) {
  const targets = articles.slice(0, MAX_ARTICLES_TO_ANALYZE);
  await Promise.all(targets.map(fetchArticlePage));
  for (const article of articles) scoreArticle(article);
  crossCheck(articles);
  return articles;
}

function sortArticles(articles) {
  return [...articles].sort((a,b) => b.score - a.score || parseDate(b.published) - parseDate(a.published));
}



export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/search") {
      const keyword = (url.searchParams.get("q") || "").trim();
      if (!keyword) return json({ error: "검색어를 입력해주세요." }, 400);
      if (keyword.length > 200) return json({ error: "검색어가 너무 깁니다." }, 400);
      try {
        let articles = deduplicate(await fetchGoogleNewsRSS(keyword));
        if (!articles.length) return json({ articles: [] });
        articles = sortArticles(await analyzeArticles(articles)).slice(0, 15);
        return json({ articles });
      } catch (e) {
        return json({ error: `검색/분석 중 오류: ${e.message || e.name || "Unknown error"}` }, 502);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

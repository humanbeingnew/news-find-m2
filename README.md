# NEWS FILTER PRO 2.1 — Cloudflare Workers

기존 Python 콘솔 프로그램을 브라우저에서 사용할 수 있는 **Cloudflare Workers + 정적 프론트엔드** 프로젝트로 변환한 버전입니다.

원본 프로그램의 핵심 흐름인 Google News RSS 검색 → 기사 URL 접근 → 제목/본문/메타정보 분석 → 위험 신호 점수 → 제목 유사도 기반 보조 교차검증을 웹 API/화면으로 옮겼습니다.

> 원본 프로그램 자체도 "가짜뉴스 확정"이 아니라 사람이 원문과 근거를 추가 확인할 필요가 있는 정도를 보여주는 도구라고 설명합니다.

## 폴더 구조

```text
news-filter-pro/
├─ public/
│  └─ index.html
├─ src/
│  └─ index.js
├─ package.json
├─ wrangler.toml
└─ README.md
```

## GitHub → Cloudflare 배포

### 방법 1: Cloudflare 대시보드에서 Git 연결

1. 이 폴더 전체를 GitHub 저장소에 업로드합니다.
2. Cloudflare에서 Workers & Pages로 이동합니다.
3. GitHub 저장소를 연결합니다.
4. 프로젝트 루트가 저장소 루트라면 별도 빌드가 필요하지 않습니다.
5. `npm run deploy` 방식으로 배포하거나 Cloudflare의 Workers Git 배포 설정을 사용합니다.

### 방법 2: 로컬에서 Wrangler

```bash
npm install
npx wrangler login
npm run dev
```

배포:

```bash
npm run deploy
```

처음 배포할 때 Cloudflare 계정 로그인이 필요합니다.

## 추천 뉴스

메인 화면에는 다음 주제의 Google News 검색 결과를 모아서 보여주는 **추천 뉴스** 영역이 추가되었습니다.

- 주요 뉴스
- 오늘 뉴스
- 한국 주요 뉴스
- 경제 뉴스
- 과학 기술 뉴스
- 사회 뉴스

추천은 최신성, 출처 다양성, 분석 가능성 등을 이용한 **노출 우선순위**입니다. 추천 순서 자체가 사실 여부나 신뢰도 순위를 뜻하지 않습니다.

## API

검색:

```text
GET /api/search?q=검색어
```

추천 뉴스:

```text
GET /api/recommendations
```

상태 확인:

```text
GET /api/health
```

## 중요한 차이점

원본 Python은 `urllib`와 `ThreadPoolExecutor`로 서버/PC에서 직접 인터넷 요청을 수행합니다. Cloudflare Workers에서는 JavaScript `fetch()`와 비동기 작업으로 같은 역할을 구현했습니다.

기사 사이트에 따라 다음 문제가 발생할 수 있습니다.

- robots/접근 제한
- 로그인 또는 유료벽
- JavaScript 렌더링 필요
- anti-bot/Cloudflare 등으로 원문 접근 실패
- HTML 구조가 달라 본문 추출이 제한됨

따라서 점수는 사실 여부를 판정하는 값이 아닙니다.

## 안전한 사용

정치·사회 이슈의 경우에도 결과의 점수/라벨만으로 사실 여부를 결론내리지 말고 원문, 원자료, 공식 발표 및 서로 다른 출처를 직접 확인해야 합니다.

## 검색 속도 개선

검색 시 원문 분석 대상은 기존 최대 12개에서 **최대 6개**로 줄였습니다.

또한 `/api/search`는 전체 분석이 끝날 때까지 기다리지 않고 **원문 분석이 먼저 끝난 기사부터 NDJSON 스트리밍으로 전송**합니다. 웹 화면도 이 스트림을 읽어 완료된 기사부터 즉시 표시하고, 모든 분석이 끝나면 최종 점수/교차검증 결과로 한 번 더 정리합니다.

즉, 느린 기사 하나 때문에 전체 결과 표시가 멈추는 구조가 아니라 **빠르게 처리된 기사부터 먼저 볼 수 있는 구조**입니다.

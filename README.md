# NEWS FILTER PRO 2.1 — GitHub + Cloudflare Workers

원본 Python 프로그램의 기능을 Cloudflare Workers에서 실행할 수 있도록 JavaScript로 옮긴 웹 버전입니다.

## 포함된 것

- `python/news_filter_pro.py` — 사용자가 처음 제공한 원본 Python 프로그램
- `src/index.js` — Cloudflare Workers API
- `public/index.html` — 웹 화면
- `wrangler.toml` — Cloudflare Workers + Static Assets 설정

## 핵심 구조

```text
GitHub 저장소
├─ python/news_filter_pro.py   # 원본 Python
├─ src/index.js                # Cloudflare 서버 코드
├─ public/index.html           # 웹 화면
└─ wrangler.toml               # Cloudflare 설정
```

## 왜 npm / package.json이 없는가?

이 프로젝트는 런타임에 npm 패키지를 필요로 하지 않습니다. 이전 버전은 `package-lock.json`과 실제 dependency tree가 맞지 않아 Cloudflare의 `npm ci` 단계에서 실패할 수 있었습니다.

이번 버전은 npm dependency를 제거해 그 문제를 피합니다.

## Cloudflare에 올리는 방법 — GitHub 연결

Cloudflare Dashboard에서 **Workers & Pages → Create application → 기존 Git 저장소 연결**을 선택하고 이 GitHub 저장소를 연결합니다.

이 프로젝트는 별도 빌드가 필요 없습니다. `wrangler.toml`이 Worker와 `public/` 정적 파일을 함께 배포하도록 되어 있습니다.

권장 설정:

- Production branch: `main`
- Build command: 비워두기
- Build output directory: 비워두기

Cloudflare가 저장소의 `wrangler.toml`을 사용하도록 프로젝트를 구성합니다.

## CLI로 직접 배포하고 싶다면

Node.js가 있는 PC에서:

```bash
npx wrangler deploy
```

또는 최신 Wrangler를 설치한 뒤:

```bash
npm install -D wrangler@latest
npx wrangler deploy
```

## 주의

- 이 앱은 가짜뉴스를 확정 판정하는 프로그램이 아닙니다.
- 점수는 사람이 원문, 출처, 근거를 추가 확인할 필요가 있는지를 보여주는 보조 신호입니다.
- 일부 언론사 사이트는 봇 차단, 로그인, 유료벽, JavaScript 렌더링 등으로 원문 분석이 제한될 수 있습니다.
- Google News RSS와 대상 기사 사이트의 네트워크 응답 상태에 따라 검색 결과가 달라질 수 있습니다.

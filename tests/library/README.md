# 원본 자료실 통합 테스트

서버 함수(`api/library-*.js`)와 화면(`index.html`)을 **임시 DB + 모조 R2**에 붙여 실제 브라우저로 검증하는 도구입니다.
운영 DB·R2·Vercel에는 접속하지 않으며 배포에도 포함되지 않습니다(`.vercelignore`).

## 구성
| 파일 | 역할 |
|---|---|
| `setup-db.sh` / `reset-db.sh` | 임시 PostgreSQL 16 기동, 기존 테이블 구조 복제(`stub-schema.sql`) + `docs/sql/` 의 자료실 SQL 적용, 초기화 |
| `shim-postgrest.js` | PostgREST 흉내 (서버 함수의 DB 호출을 임시 DB로 연결) |
| `fake-s3.js` | R2 흉내. 임시 주소(SigV4)를 실제로 다시 계산해 검증하고 만료 시각도 확인 |
| `api-server.js` | `/api/*`를 실제 핸들러에 연결하고 `index.html`을 제공 |
| `api-test.js` | 서버 함수 통합 테스트 (로그인/권한/업로드/버전/삭제/사용량 등) |
| `e2e-user.js`, `e2e-admin.js` | Playwright 브라우저 테스트 (모바일 사용자 화면, 관리자 화면) |

단위 테스트(권한 판정, R2 서명)는 의존성 없이 저장소 루트에서 `node --test tests/library-core.test.js`.

## 실행
```bash
cd tests/library
npm install                 # pdfjs-dist(로컬 PDF 렌더러), pg
sudo ./setup-db.sh          # 최초 1회 (postgres 서버/스키마 준비)
node make-samples.js        # 샘플 PDF/PNG 생성 (Playwright + Chromium 필요)
./reset-db.sh && node api-test.js
./reset-db.sh && node e2e-user.js
./reset-db.sh && node e2e-admin.js
```
Playwright가 전역 설치되어 있지 않으면 `npm i playwright` 후 `CHROMIUM_PATH`로 브라우저 경로를 지정합니다.

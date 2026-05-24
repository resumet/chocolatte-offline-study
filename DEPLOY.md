# Vercel 배포

## 배포 전 설정

Vercel 프로젝트의 Environment Variables에 다음 값을 추가합니다.

```text
ADMIN_PASSWORD=plus43210
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`.env` 파일은 `.gitignore`에 포함되어 있으므로 Vercel에 자동 업로드되지 않습니다.

## 배포 명령

```bash
npm i -g vercel
vercel login
vercel
vercel --prod
```

## Supabase 설정

Supabase SQL Editor에서 `supabase-schema.sql` 내용을 실행해 `participants` 테이블을 먼저 만듭니다.

기존 `data/list.json` 데이터를 Supabase로 옮기려면 로컬 `.env`에 Supabase 값을 넣은 뒤 아래 명령을 실행합니다.

```bash
npm run migrate:supabase
```

## 주의

`SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 비밀키입니다. 브라우저 JavaScript나 `NEXT_PUBLIC_` 같은 공개 환경변수에 넣으면 안 됩니다.

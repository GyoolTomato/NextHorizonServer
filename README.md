# NextHorizonServerClean

`C:\GitHub\NextHorizonServer\dev.db`를 사용하는 최소 예제 서버입니다.

## 설치

```bat
cd /d C:\GitHub\NextHorizonServer
copy .env.example .env
npm install
npx prisma generate
```

`.env`의 `DATABASE_URL`이 실제 DB 경로와 같은지 확인합니다.

```env
DATABASE_URL="file:C:/GitHub/NextHorizonServer/dev.db"
PORT=3099
```

## 직접 실행

```bat
npm start
```

정상 로그:

```text
database ready: 3 items, 6 users
server running on port 3099
```

## 확인

```bat
curl http://localhost:3099/health
curl "http://localhost:3099/user?uid=test-user"
curl http://localhost:3099/catalog
```

## PM2 등록

```bat
pm2.cmd delete NHServer
pm2.cmd start server.js --name NHServer --cwd C:\GitHub\NextHorizonServer
pm2.cmd save
```

기존 서버와 달리 시작 시 카탈로그를 매번 수정하지 않습니다. DB 연결과 핵심 테이블을 확인한 뒤 서버를 시작합니다.

## 로그

로그인과 모든 API 요청, 주요 데이터 변경, 서버 오류는 JSON Lines 형식으로 기록됩니다.

```text
.logs/YYYY-MM-DD-server.txt
```

파일 날짜와 로그 시각은 시스템 시간대와 관계없이 한국시간(`Asia/Seoul`)을 사용합니다. 한국시간 자정 이후 첫 로그부터 새 날짜 파일에 기록됩니다.

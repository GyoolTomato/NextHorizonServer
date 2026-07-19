# NextHorizonServerClean

기존 `C:\GitHub\NextHorizon\ServerData\dev.db`를 그대로 사용하는 최소 예제 서버입니다.

## 설치

```bat
cd /d C:\GitHub\NextHorizonServerClean
copy .env.example .env
npm install
npx prisma generate
```

`.env`의 `DATABASE_URL`이 실제 DB 경로와 같은지 확인합니다.

```env
DATABASE_URL="file:C:/GitHub/NextHorizon/ServerData/dev.db"
PORT=3000
```

## 직접 실행

```bat
npm start
```

정상 로그:

```text
database ready: 3 items, 6 users
server running on port 3000
```

## 확인

```bat
curl http://localhost:3000/health
curl "http://localhost:3000/user?uid=test-user"
curl http://localhost:3000/catalog
```

## PM2 등록

```bat
pm2.cmd delete NHServer
pm2.cmd start server.js --name NHServer --cwd C:\GitHub\NextHorizonServerClean
pm2.cmd save
```

기존 서버와 달리 시작 시 카탈로그를 매번 수정하지 않습니다. DB 연결과 핵심 테이블을 확인한 뒤 서버를 시작하므로, 잘못된 DB를 지정하면 로그에 `DATABASE_URL`과 실제 오류가 바로 표시됩니다.

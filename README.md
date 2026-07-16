# 유니티 포트폴리오 서버

가챠게임 포트폴리오용 Node.js/Express 서버입니다. SQLite + Prisma로 유저, 마스터 데이터, 유저별 인벤토리, 가챠 배너, 가챠 이력을 저장합니다.

## 실행

처음 받았거나 Prisma Client가 없을 때:

```bash
npm install
npm run db:generate
npm start
```

서버 기본 포트는 `3000`입니다. 환경 변수는 `.env.example`을 기준으로 `.env`에 설정합니다.

헬스체크:

```bash
curl http://localhost:3000/health
```

정상 응답:

```json
{"ok":true}
```

## PM2 실행

```bash
cd /home/gyools/UnityPortfolioServer
npm run db:generate
pm2 start server.js --name UPServer
```

상태와 로그 확인:

```bash
pm2 status
pm2 logs UPServer
```

코드나 DB 스키마 변경 후 재시작:

```bash
pm2 restart UPServer
```

부팅 후 자동 실행이 필요하면:

```bash
pm2 save
pm2 startup
```

## DB

기본 DB 파일:

```text
/home/gyools/UnityPortfolioServer/dev.db
```

`.env`의 `DATABASE_URL`이 다른 값을 가리키면 해당 DB를 사용합니다.

DB를 UI로 확인:

```bash
npx prisma studio
```

Prisma 스키마 검증:

```bash
npx prisma validate
```

문법 검사:

```bash
npm test
```

## 주요 구조

- `User`: 게스트 계정, 닉네임, 레벨
- `Item`: 아이템 마스터 데이터. 골드 같은 재화성 데이터도 여기서 관리
- `Armor`: 캐릭터 방어구 장비 마스터 데이터
- `Weapon`: 캐릭터 무기 장비 마스터 데이터
- `Mission`: 퀘스트 마스터 데이터
- `Character`: 캐릭터 마스터 데이터. 스탯과 스킬 키를 포함
- `PlayerCharacter`: 유저별 캐릭터 보유량
- `PlayerItem`: 유저별 아이템 보유량
- `PlayerArmor`: 유저별 방어구 보유량
- `PlayerWeapon`: 유저별 무기 보유량
- `GachaBanner`: 가챠 배너와 비용 아이템
- `GachaPoolItem`: 배너별 캐릭터 확률 가중치
- `GachaHistory`: 뽑기 이력

`Currency` 테이블은 제거했습니다. 재화성 데이터는 `Item` 마스터와 `PlayerItem` 보유량으로 관리합니다.

## 엑셀 데이터 반영 상태

현재 반영된 마스터 데이터:

- `_101_Items.xlsx` -> `Item`
- `_102_Character.xlsx` -> `Character`
- `_104_Missions.xlsx` -> `Mission`
- `_105_Armors.xlsx` -> `Armor`
- `_106_Weapons.xlsx` -> `Weapon`

반영 후 업로드된 엑셀 파일은 프로젝트 루트에서 삭제했습니다.

## API

### 헬스체크

```http
GET /health
```

### 게스트 로그인

```http
POST /auth/guest
Content-Type: application/json

{
  "guestId": "optional-client-saved-id",
  "nickname": "Player"
}
```

응답의 `token`을 Unity에서 저장한 뒤 인증이 필요한 API에 사용합니다.

```http
Authorization: Bearer <token>
```

### 내 정보

```http
GET /me
Authorization: Bearer <token>
```

### 인벤토리

```http
GET /inventory
Authorization: Bearer <token>
```

응답은 캐릭터, 아이템, 방어구, 무기를 분리해서 반환합니다.

```json
{
  "characters": [],
  "items": [],
  "armors": [],
  "weapons": []
}
```

### 배너 목록

```http
GET /gacha/banners
```

### 가챠 실행

```http
POST /gacha/pull
Authorization: Bearer <token>
Content-Type: application/json

{
  "bannerId": "standard",
  "count": 10
}
```

`count`는 `1` 또는 `10`만 허용합니다. 현재 가챠는 재화 차감 없이 캐릭터 지급과 이력 저장만 서버 트랜잭션 안에서 처리합니다. 비용 정보는 응답의 `costType`, `costAmount`로 내려갑니다.

### 구버전 유저 조회

```http
GET /user?uid=<guestId>
```

기존 Unity 프로토타입 호환용입니다. 신규 클라이언트는 `/auth/guest`, `/me`, `/inventory`, `/gacha/pull` 흐름을 사용하세요.

## Unity 연동 메모

클라이언트는 `guestId`와 `token`만 저장하면 됩니다. 캐릭터, 아이템, 장비 보유량과 가챠 결과는 클라이언트에서 계산하지 말고 서버 응답을 그대로 반영하는 방식이 안전합니다.

# 미션 API

POST `/api/mission/list`: `{ "userId": 1 }`

POST `/api/mission/claim`: `{ "userId": 1, "missionKey": 1040001 }`

목록 및 수령 응답의 `missions`에는 missionKey, progress, isClaimed만 포함됩니다.
제목·목표 수량·보상 등 상세 표시는 클라이언트의 `_104` 테이블을 사용합니다.
완료 여부는 progress와 테이블 count를 비교합니다. 주기 판별용 날짜는 서버 내부에서만 사용합니다.

수령 응답은 success, missionKey, exp(기본 보상), rewards(추가보상, 중복 유지),
items(변경된 아이템의 최종 수량), playerExperience, missions(수령 후 목록)를 반환합니다.
playerExperience에는 level, exp, grantedExp, appliedExp만 포함합니다.

- Daily: KST 매일 04:00 / Weekly: KST 월요일 04:00 (`game-time.js`).
- 조회, 진행도 갱신, 수령 시 주기가 달라지면 지연 초기화합니다.
- LogIn: 게임 날짜당 1회. PlayerMissionLogin은 로그인 날짜 중복 방지용입니다.
- GetIt_ExpCard: 신규 지급/획득 API/미션 보상으로 획득한 실제 수량만큼 증가합니다.
- WorkCount: 성공한 미션 보상 수령마다 1 증가합니다.
- Kill: 전투 구현 후 검증된 결과를 `missions.advance(tx, userId, "Kill", amount)`로 연결합니다.
- 보상 지급, 경험치/레벨 갱신, 수령 표시와 연계 진행도는 하나의 트랜잭션입니다.
- 완료 전 수령 400, 없는 유저/미션 404, 중복 수령 409, 테이블 오류 500.
- key=0 또는 quantity=0은 무보상입니다. 배열 길이 불일치와 유효하지 않은 보상은 오류로 기록합니다.
- PlayerExp(1010003)는 PlayerItem에 저장하지 않습니다.

클라이언트는 ServerAPI.Mission.cs의 Send_MissionList / Send_MissionClaim과
Parse_MissionList / Parse_MissionClaim을 제공합니다. UI, GameData 자동 반영은 연결하지 않습니다.

## 배포

server.js뿐 아니라 missions.js, game-time.js, prisma/schema.prisma도 함께 배포합니다.
`npm run prisma:generate` 후 서버를 재시작합니다. 필요한 상태 테이블은 시작 시 생성됩니다.
기존 유저 진행도는 이후 실제 이벤트부터 기록하며 과거 활동을 소급하지 않습니다.
`.live`는 포트 3000용 스냅샷입니다. 기존 운영 DB를 스냅샷 DB로 덮어쓰면 기존 데이터가 바뀌므로
코드만 갱신할 때는 운영 DB를 유지합니다.

검증: `node test-missions.js` (임시 DB 복사본과 로컬 3198 포트 사용).

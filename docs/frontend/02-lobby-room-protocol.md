# 로비 / 방 규격

클라이언트와 서버가 합의한 방 생성·참여 규격. 정의는
[packages/shared/src/protocol/room.ts](../../packages/shared/src/protocol/room.ts) 한 곳에 있다.

## 1. 방 코드 = roomId

Colyseus의 `roomId`를 `onCreate`에서 **사람이 읽을 수 있는 4자리 코드로 교체**한다.

```ts
this.roomId = await allocateRoomCode();  // 예: "A3F9"
```

덕분에 참여 경로가 하나로 통일된다:

| 사용자 동작 | 클라이언트 호출 |
|---|---|
| 방 목록에서 선택 | `client.joinById(item.roomCode, options)` |
| 방 코드 직접 입력 | `client.joinById(inputCode, options)` |

`filterBy`나 별도 매치메이킹 로직이 필요 없다.

**코드 알파벳**: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31자)
`0/O`, `1/I/L` 처럼 눈으로 구분이 어려운 글자를 뺐다 — 코드를 구두로 불러줄 수 있어야 한다.
소문자로 입력해도 `normalizeRoomCode()`가 대문자로 올려준다.

중복은 `matchMaker.getRoomById()`로 확인하고 최대 10회 재발급한다. 31⁴ ≈ 92만 조합이라
데모 규모에서는 첫 시도에 끝난다.

## 2. 메시지 / 옵션

### 방 생성 — `client.create('game', CreateRoomOptions)`
```ts
interface CreateRoomOptions {
  nickname: string;   // 1~12자
  roomName: string;   // 1~16자
  password?: string;  // 비우면 공개 방 (최대 16자)
}
```

### 방 참여 — `client.joinById(roomCode, JoinRoomOptions)`
```ts
interface JoinRoomOptions {
  nickname: string;
  password?: string;
}
```

### 방 목록 — `GET /rooms`
```ts
interface RoomListItem {
  roomCode: string;    // = roomId
  roomName: string;
  clients: number;
  maxClients: number;
  hasPassword: boolean;
  locked: boolean;
}
```

> Colyseus 0.17 클라이언트 SDK에는 **`getAvailableRooms()`가 없다**(0.16까지 있었다).
> 서버가 `matchMaker.query()`로 직접 노출한다.
> 응답에 **비밀번호는 절대 포함되지 않는다** — `hasPassword` 플래그만 내려간다.

### 상태 — `room.state`
```ts
{
  roomCode: string;
  roomName: string;
  hasPassword: boolean;
  players: Map<sessionId, {
    nickname: string;
    x: number;
    y: number;
    aimAngle: number;
    lastProcessedSeq: number;
  }>;
}
```

### 입력 — `room.send('input', PlayerInputMessage)`
```ts
interface PlayerInputMessage {
  seq: number;       // 단조 증가. 되감기면 서버가 무시한다
  moveX: number;     // -1~1
  moveY: number;     // -1~1
  aimAngle: number;  // 라디안
}
```

## 3. 입력 전송 규칙 (클라이언트가 지켜야 할 것)

**입력은 20Hz(서버 틱과 동일)로 보낸다.** `INPUT_SEND_RATE` 상수를 쓴다.

서버는 "마지막 입력을 새 입력이 올 때까지 매 틱 반복 적용"하는 모델이다. 따라서:
- 60fps로 보내면 틱 사이의 입력 2개가 덮어써져 **그냥 버려진다** — 대역폭만 쓰고 이득이 없다
- 아예 안 보내면 **마지막 입력이 계속 적용된다** — 정지하려면 `moveX/moveY = 0`을 명시적으로 보내야 한다

**대각선은 클라이언트도 정규화한다.** 서버(`World#setInput`)도 정규화하지만, 예측을 붙였을 때
같은 값을 써야 결과가 어긋나지 않는다.

> 이 모델의 한계: 클라이언트는 서버가 어떤 입력을 어느 틱에 썼는지 알 수 없어 **완전히 동일한
> 재현이 불가능**하다. 정밀한 재조정이 필요해지면 서버를 입력 큐 방식으로 바꿔야 한다.
> 지금은 협동 PvE라 근사 예측으로 충분하다고 보고 미뤄뒀다.

## 4. 입장 거절 코드

`ServerError`의 `code`로 내려온다. 클라이언트는 `err.code`로 분기해 한국어 메시지를 띄운다
(`ColyseusConnection#toJoinError`).

| 코드 | 의미 |
|---|---|
| `4001` `INVALID_PASSWORD` | 비밀번호 불일치 |
| `4002` `INVALID_NICKNAME` | 닉네임 형식 오류 |
| `4003` `INVALID_ROOM_NAME` | 방 이름 형식 오류 |
| `4212` | (Colyseus 내장) 방 없음 / 좌석 예약 만료 |

검증은 **전부 `onAuth`에서** 끝낸다. `onJoin`에서 던지면 좌석이 이미 예약된 뒤라 정리가 지저분해진다.

## 5. 새 메시지를 추가할 때

`sanitize*` 계열을 반드시 통과시킨다. 클라이언트 입력은 신뢰하지 않는다 —
실제로 타입 미검증 때문에 좌표가 `NaN`으로 영구 오염된 사고가 있었다
([backend/10](../backend/10-work-report-nan-input-bug.md)).

검증 함수는 `shared/protocol`에 두고 **클라이언트와 서버가 같은 함수를 쓴다.**
클라이언트에서 미리 걸러 UX를 좋게 하고, 서버가 최종 판정한다.

import { Encoder } from '@colyseus/schema';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { playground } from '@colyseus/playground';
import type { NextFunction, Request, Response } from 'express';
import type { RoomListItem } from '@dropfall/shared';
import { GameRoom } from './rooms/GameRoom';

// .env가 있으면 그 값들을 process.env에 얹는다(Node 20.6+ 내장 API — dotenv 패키지
// 불필요). 없어도 그냥 넘어간다 — 프로덕션(systemd)은 환경변수를 직접 주입하므로
// .env 파일 자체가 없는 게 정상이다. 코어 AI 페르소나 키(ANTHROPIC_API_KEY 등)를
// 로컬에서 편하게 넣어두는 용도(packages/server/.env, .gitignore 처리됨).
try {
  process.loadEnvFile();
} catch {
  // .env 없음 — 무시
}

/**
 * 스키마 인코딩 버퍼. 기본값(8KB)은 탐색 안개(칸당 1비트 × 128×128 = 2KB)가 처음
 * 합류자에게 통째로 나갈 때 넘친다 — 그 순간 방이 죽는다. 안개 2KB + 기존 상태에
 * 여유를 더해 32KB로 올린다(프로세스당 한 번 잡는 버퍼라 메모리 부담은 없다).
 */
Encoder.BUFFER_SIZE = 32 * 1024;

const port = Number(process.env.PORT) || 2567;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * 개발 중에는 클라이언트(:5173)와 서버(:2567)의 오리진이 다르다.
 * 프로덕션에서는 CLIENT_ORIGIN으로 좁힌다 — 홈서버에 그대로 노출되는 값이라
 * 기본값을 '*'로 두지 않는다.
 */
const allowedOrigin = process.env.CLIENT_ORIGIN ?? (isProduction ? '' : '*');

const server = defineServer({
  // permessage-deflate(WebSocket 프레임 압축)을 켠다. 반복적인 숫자/문자열이 많은
  // 스키마 상태라 압축이 잘 먹는다 — 같은 PATCH_RATE에서도 실제 회선에 나가는
  // 바이트가 줄어서, 2인 이상 접속 시 대역폭 병목(docs/backend/47)을 완화하면서
  // PATCH_RATE를 반응성 쪽으로 다시 올릴 여유를 만든다. threshold를 둬서 아주
  // 작은 메시지(수십 바이트짜리 입력 등)까지 압축 시도하느라 오히려 CPU만 쓰는
  // 걸 막는다 — 압축 자체의 이득이 오버헤드를 넘는 크기부터만 압축한다.
  transport: new WebSocketTransport({
    perMessageDeflate: { threshold: 1024 },
  }),
  rooms: {
    game: defineRoom(GameRoom),
  },
  express: (app) => {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (allowedOrigin) {
        res.header('Access-Control-Allow-Origin', allowedOrigin);
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });

    // 방 목록. Colyseus 0.17에는 클라이언트 SDK의 getAvailableRooms()가 없어서
    // 직접 노출한다. 비밀번호는 절대 내려보내지 않고 hasPassword만 알려준다.
    app.get('/rooms', async (_req: Request, res: Response) => {
      try {
        const rooms = await matchMaker.query({ name: 'game' });
        const list: RoomListItem[] = rooms.map((room) => ({
          roomCode: room.roomId,
          roomName: (room.metadata?.roomName as string) ?? '이름 없는 방',
          clients: room.clients,
          maxClients: room.maxClients,
          hasPassword: Boolean(room.metadata?.hasPassword),
          locked: Boolean(room.locked),
        }));
        res.json(list);
      } catch (err) {
        console.error('[DropFall] GET /rooms failed:', err);
        res.status(500).json({ error: 'room-list-failed' });
      }
    });

    // 프로덕션에서는 절대 노출하지 않는다 — 개발용 브라우저 디버그 도구
    if (!isProduction) {
      app.use('/playground', playground());
    }
  },
});

server.listen(port);

console.log(`[DropFall] game server listening on ws://localhost:${port}`);
console.log(`[DropFall] room list: http://localhost:${port}/rooms`);
if (!isProduction) {
  console.log(`[DropFall] playground: http://localhost:${port}/playground`);
}

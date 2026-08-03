import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { playground } from '@colyseus/playground';
import type { NextFunction, Request, Response } from 'express';
import type { RoomListItem } from '@dropfall/shared';
import { GameRoom } from './rooms/GameRoom';

const port = Number(process.env.PORT) || 2567;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * 개발 중에는 클라이언트(:5173)와 서버(:2567)의 오리진이 다르다.
 * 프로덕션에서는 CLIENT_ORIGIN으로 좁힌다 — 홈서버에 그대로 노출되는 값이라
 * 기본값을 '*'로 두지 않는다.
 */
const allowedOrigin = process.env.CLIENT_ORIGIN ?? (isProduction ? '' : '*');

const server = defineServer({
  transport: new WebSocketTransport(),
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

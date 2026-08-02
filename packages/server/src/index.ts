import { defineRoom, defineServer } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { playground } from '@colyseus/playground';
import { GameRoom } from './rooms/GameRoom';

const port = Number(process.env.PORT) || 2567;
const isProduction = process.env.NODE_ENV === 'production';

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: {
    game: defineRoom(GameRoom),
  },
  express: (app) => {
    // 프로덕션에서는 절대 노출하지 않는다 — 개발용 브라우저 디버그 도구
    if (!isProduction) {
      app.use('/playground', playground());
    }
  },
});

server.listen(port);

console.log(`[DropFall] game server listening on ws://localhost:${port}`);
if (!isProduction) {
  console.log(`[DropFall] playground: http://localhost:${port}/playground`);
}

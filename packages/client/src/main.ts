import type Phaser from 'phaser';
import './ui/styles.css';
import { LobbyApp } from './ui/LobbyApp';
import { loadImageAssets } from './ui/assets';
import { createGame } from './game/createGame';
import type { GameConnection } from './net/GameConnection';
import { IS_LOCAL_MODE, readAutoEntry } from './net/config';
import { createRoom, joinRoomByCode } from './net/ColyseusConnection';
import { LocalConnection } from './net/LocalConnection';

function requireElement(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`index.html에 ${selector} 가 없습니다.`);
  return node;
}

const uiRoot = requireElement('#ui-root');
const gameRoot = requireElement('#game-root');

let game: Phaser.Game | null = null;
let connection: GameConnection | null = null;

const lobby = new LobbyApp(uiRoot, enterGame);

function enterGame(next: GameConnection): void {
  connection = next;

  uiRoot.hidden = true;
  gameRoot.hidden = false;

  game = createGame(gameRoot, next);
  next.onDisconnect((reason) => leaveGame(reason));
}

function leaveGame(message = ''): void {
  game?.destroy(true);
  game = null;

  void connection?.leave();
  connection = null;

  gameRoot.hidden = true;
  uiRoot.hidden = false;
  lobby.reset(message);
}

// ESC로 언제든 로비로 돌아온다. 시연 중 막히는 상황을 만들지 않기 위한 안전장치다.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && game) leaveGame();
});

async function bootstrap(): Promise<void> {
  // 존재하는 UI 이미지 에셋만 CSS 변수로 등록한다. 없으면 플레이스홀더가 그대로 쓰인다.
  await loadImageAssets();

  if (IS_LOCAL_MODE) {
    // ?local=1 — 로비를 건너뛰고 바로 오프라인 모드로 진입한다.
    enterGame(new LocalConnection('생존자'));
    return;
  }

  const auto = readAutoEntry();
  if (!auto) {
    lobby.start();
    return;
  }

  // 딥링크 진입. 실패하면 이유를 로비에 띄우고 평소 흐름으로 되돌린다.
  try {
    const next =
      auto.mode === 'create'
        ? await createRoom({
            nickname: auto.nickname,
            roomName: auto.roomName,
            password: auto.password,
          })
        : await joinRoomByCode(auto.roomCode, {
            nickname: auto.nickname,
            password: auto.password,
          });
    enterGame(next);
  } catch (err) {
    lobby.start();
    lobby.reset((err as Error).message);
  }
}

void bootstrap();

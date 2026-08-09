import type Phaser from 'phaser';
import './ui/styles.css';
import { RoomPhase } from '@dropfall/shared';
import { LobbyApp } from './ui/LobbyApp';
import { WaitingRoom } from './ui/WaitingRoom';
import { loadImageAssets } from './ui/assets';
import { loadCharacterAtlas } from './ui/characterPortrait';
import { loadGameFonts } from './ui/fonts';
import { EXIT_GAME_EVENT, createGame, type ExitGameDestination } from './game/createGame';
import type { GameConnection } from './net/GameConnection';
import { IS_LOCAL_MODE, readAutoEntry } from './net/config';
import { createRoom, joinRoomByCode } from './net/ColyseusConnection';
import { LocalConnection } from './net/LocalConnection';
import { showQuitConfirm } from './ui/confirmQuit';

function requireElement(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`index.html에 ${selector} 가 없습니다.`);
  return node;
}

const appRoot = requireElement('#app');
const uiRoot = requireElement('#ui-root');
const gameRoot = requireElement('#game-root');

let game: Phaser.Game | null = null;
let connection: GameConnection | null = null;

const lobby = new LobbyApp(uiRoot, enterRoom);

/**
 * 화면 전환은 세 단계다.
 *   타이틀/방 목록 (LobbyApp)  →  대기실 (WaitingRoom)  →  인게임 (Phaser)
 * 방에 들어가는 것과 게임이 시작되는 것은 별개라 두 단계로 나눠 둔다.
 */
function enterRoom(next: GameConnection): void {
  connection = next;
  next.onDisconnect((reason) => leaveRoom(reason));

  // 오프라인 모드는 대기실을 거치지 않는다 (혼자라 준비할 상대가 없다).
  if (next.getLobbyView().phase === RoomPhase.PLAYING) {
    startGame();
    return;
  }

  const waiting = new WaitingRoom(uiRoot, next, startGame, () => leaveRoom());
  waiting.start();
}

function startGame(): void {
  if (!connection || game) return;

  uiRoot.hidden = true;
  gameRoot.hidden = false;
  game = createGame(gameRoot, connection);
}

function leaveRoom(message = '', screen: ExitGameDestination = 'title'): void {
  game?.destroy(true);
  game = null;

  void connection?.leave();
  connection = null;

  gameRoot.hidden = true;
  uiRoot.hidden = false;
  lobby.reset(message, screen);
}

// 게임 안에서 "나가겠다"고 알려올 때(패배 화면에서 아무 키나 눌렀을 때) — 씬은 자기
// 자신을 파괴할 수 없으므로 요청만 보내고, 정리는 여기서 한다(§createGame.EXIT_GAME_EVENT).
window.addEventListener(EXIT_GAME_EVENT, (event) => {
  if (!connection) return;
  leaveRoom('', (event as CustomEvent<ExitGameDestination>).detail);
});

// ESC로 언제든 로비로 돌아올 수 있다(시연 중 막히는 상황을 만들지 않기 위한
// 안전장치) — 다만 실수로 누른 ESC 한 번에 진행 중이던 판을 통째로 잃지 않도록,
// 바로 나가는 대신 확인창을 한 번 거친다.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && connection) {
    showQuitConfirm(appRoot, () => leaveRoom());
  }
});

async function bootstrap(): Promise<void> {
  // 존재하는 UI 이미지 에셋만 CSS 변수로 등록한다. 없으면 플레이스홀더가 그대로 쓰인다.
  await Promise.all([loadImageAssets(), loadCharacterAtlas(), loadGameFonts()]);

  if (IS_LOCAL_MODE) {
    // ?local=1 — 로비를 건너뛰고 바로 오프라인 모드로 진입한다.
    enterRoom(new LocalConnection('생존자'));
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
    enterRoom(next);
  } catch (err) {
    lobby.start();
    lobby.reset((err as Error).message);
  }
}

void bootstrap();

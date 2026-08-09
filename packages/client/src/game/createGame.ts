import Phaser from 'phaser';
import type { GameConnection } from '../net/GameConnection';
import { weaponsData } from '@dropfall/shared';
import { WEAPON_VISUALS } from './render/weaponFx';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';

/** 씬들이 연결 객체를 꺼내가는 registry 키. 씬 시작 순서에 의존하지 않기 위해 registry를 쓴다. */
export const CONNECTION_KEY = 'connection';
/** HudScene이 건축모드 표시줄을 그리려고 GameScene의 InputController를 꺼내가는 키. */
/**
 * HudScene이 등록하는 "지금 포인터가 UI 위인가" 판정. 모달은 차단막 없이 게임 위에
 * 떠 있으므로, 게임 입력(발사·건축)이 모달을 뚫고 나가지 않게 이 콜백으로 막는다.
 * 발사는 이벤트가 아니라 매 프레임 폴링이라 Phaser의 이벤트 전파만으로는 안 막힌다.
 */
export const HUD_BLOCK_KEY = 'hudBlocksPointer';

/** HudScene이 등록하는 코어 상호작용 콜백. GameScene의 E 입력이 이걸 먼저 부른다. */
export const CORE_INTERACT_KEY = 'coreInteract';

export const INPUT_CONTROLLER_KEY = 'inputController';

/**
 * 게임을 끝내고 바깥 화면(로비 DOM)으로 돌아가 달라는 요청.
 *
 * Phaser 씬은 `main.ts`가 들고 있는 연결·화면 전환을 직접 만질 수 없다 — 씬을 파괴하는
 * 쪽이 씬 안에 있으면 자기 발밑을 무너뜨리는 꼴이 된다. 그래서 DOM 이벤트 하나로
 * "나가고 싶다"만 알리고, 실제 정리(게임 파괴 → 연결 종료 → 로비 표시)는 바깥이 한다.
 * ESC 확인창이 이미 `window` 이벤트로 도는 것과 같은 결이다.
 */
export const EXIT_GAME_EVENT = 'dropfall:exit-game';

/** 돌아갈 화면. 혼자하기는 타이틀로, 멀티는 다음 방을 고르도록 방 목록으로 보낸다. */
export type ExitGameDestination = 'title' | 'browse';

export function requestExitGame(to: ExitGameDestination): void {
  /*
   * **한 박자 미뤄서 보낸다.** 이 함수는 Phaser 입력 콜백 안에서 불리는데, 이벤트를
   * 그 자리에서 던지면 바깥이 같은 호출 스택에서 `game.destroy()`를 부른다 — 입력을
   * 처리하던 중에 그 입력 시스템이 통째로 사라지는 셈이다. 다음 태스크로 넘기면
   * Phaser가 이번 프레임을 끝낸 뒤에 정리가 시작된다.
   */
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent<ExitGameDestination>(EXIT_GAME_EVENT, { detail: to }));
  }, 0);
}

/**
 * GameScene이 매 프레임 갱신하는 내 캐릭터의 **예측 좌표**(`PlayerPredictor.
 * renderPosition`) — `{ x, y } | undefined`. HudScene은 이 값이 있으면 그걸,
 * 없으면(아직 예측이 초기화 전) 스냅샷의 보간 좌표를 대신 쓴다.
 *
 * 왜 필요한가: `HudScene.update()`는 `connection.getSnapshot()`을 GameScene과
 * 별개로 직접 받는다 — GameScene의 `EntityRenderer.sync(snapshot, localOverride)`가
 * 내 캐릭터 스프라이트에만 적용하는 예측 보정을, HudScene 쪽 소비자(미니맵 등)는
 * 전혀 모른다. 그 결과 월드 화면의 내 캐릭터는 예측으로 매끈해졌는데 미니맵 점은
 * 여전히 순수 보간(네트워크 지터에 취약)이라 "미니맵에서만 순간이동"하는 것처럼
 * 보이는 버그로 이어졌다(docs/backend/55 후속 수정).
 */
export const LOCAL_POSITION_KEY = 'localPredictedPosition';

/**
 * HudScene이 등록하는 채팅 로그 append 콜백. 말풍선은 GameScene의 EntityRenderer가
 * 그리지만(캐릭터 컨테이너를 들고 있는 쪽이 GameScene이라서) 하단 로그 패널은
 * HudScene 소속(DevConsole과 같은 DOM 오버레이)이라, GameScene이 onChatMessage를
 * 구독한 뒤 이 키로 로그에도 넘겨준다.
 */
export const CHAT_LOG_KEY = 'chatLog';

/**
 * 렌더링 정책 (docs/02-tech-spec.md §7.1~7.2)
 *
 * 캔버스는 **네이티브 해상도**(창 크기)로 두고, 월드 카메라만 정수배로 줌한다.
 *  - 저해상도 캔버스를 통째로 확대하는 방식은 UI 텍스트까지 뭉갠다.
 *    특히 한글은 자소 조합 구조라 8px에서 판독이 불가능하다.
 *  - FIT 스케일은 소수배(예: 2.49배) 확대가 나와서 픽셀 크기가 들쭉날쭉해진다.
 *
 * 픽셀아트 룩은 정수배 카메라 줌 + pixelArt/roundPixels로 유지된다.
 */
export function createGame(parent: HTMLElement, connection: GameConnection): Phaser.Game {
  /*
   * **물리 픽셀 기준으로 렌더링한다.**
   *
   * Windows 배율(125%/150%)이 걸린 화면에서는 CSS 픽셀과 물리 픽셀이 어긋난다.
   * 캔버스를 CSS 크기(RESIZE)로 만들면 게임 픽셀 1개가 물리 픽셀 2.5개 같은 소수
   * 배로 그려지는데, 이때 브라우저가 어느 열을 3픽셀로 만들지는 캔버스의 서브픽셀
   * 위상에 달려 있어 **스크롤할 때마다 뒤바뀐다** — 화면 전체가 자글자글 기어다니고,
   * 포장 타일처럼 규칙적 패턴은 통째로 번쩍인다(측정: 배율 100%에선 프레임 간 픽셀
   * 불일치 0%, 125%에선 반 픽셀 위상 어긋남 발생).
   *
   * 캔버스 버퍼를 물리 픽셀 크기로 잡고 CSS로 1/DPR 축소(zoom)하면, 카메라 줌이
   * 물리 픽셀의 정수배가 되어 어떤 배율에서도 픽셀이 고정된다.
   */
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    backgroundColor: '#14161d',
    scale: {
      // RESIZE는 CSS 크기를 그대로 버퍼 크기로 쓴다 — DPR을 끼워 넣을 수 없어서
      // NONE + zoom(1/dpr)으로 직접 잡고, 창 크기 변화는 아래에서 손으로 따라간다.
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: Math.round(parent.clientWidth * dpr) || 1,
      height: Math.round(parent.clientHeight * dpr) || 1,
      zoom: 1 / dpr,
    },
    // 배열의 첫 씬만 자동 시작된다. HUD는 GameScene이 launch로 띄운다.
    scene: [GameScene, HudScene],
  });

  // NONE 모드는 창 크기를 따라가지 않는다 — 직접 듣는다. DPR도 매번 다시 읽는다
  // (창을 다른 배율의 모니터로 옮기면 devicePixelRatio가 바뀐다).
  const onResize = (): void => {
    const nextDpr = Math.max(1, window.devicePixelRatio || 1);
    game.scale.zoom = 1 / nextDpr;
    game.scale.resize(
      Math.round(parent.clientWidth * nextDpr) || 1,
      Math.round(parent.clientHeight * nextDpr) || 1,
    );
  };
  window.addEventListener('resize', onResize);
  game.events.once(Phaser.Core.Events.DESTROY, () => window.removeEventListener('resize', onResize));

  game.registry.set(CONNECTION_KEY, connection);

  // 개발 중 콘솔/자동화에서 상태를 들여다보기 위한 핸들. 프로덕션 번들에는 포함되지 않는다.
  // weaponsData/WEAPON_VISUALS까지 얹어두면 "그려진 총구와 서버가 총알을 만드는 지점이
  // 같은가" 같은 정합성 확인을 브라우저에서 그대로 돌려볼 수 있다.
  if (import.meta.env.DEV) {
    (window as unknown as { __dropfall?: unknown }).__dropfall = {
      game,
      connection,
      weaponsData,
      weaponVisuals: WEAPON_VISUALS,
    };
  }

  return game;
}

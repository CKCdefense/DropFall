import { resolveAssetUrl } from './assets';

/**
 * 갈무리(Galmuri) 픽셀 폰트 등록.
 *
 * **CSS @font-face 대신 FontFace API를 쓰는 이유**
 * 폰트 파일은 `public/`에 있어서 Vite가 경로를 재작성해주지 않는다. CSS에 절대경로를
 * 쓰면 GitHub Pages 하위경로(`/DropFall/`)에서 깨진다 — 이미지 에셋과 같은 문제라
 * 같은 해법(`resolveAssetUrl`)을 쓴다. (assets.ts 참고)
 *
 * **await 해야 하는 이유**
 * Phaser의 캔버스 텍스트는 그리는 시점에 폰트가 없으면 폴백으로 래스터화하고, 나중에
 * 폰트가 도착해도 다시 그리지 않는다. 로드를 기다린 뒤에 게임을 띄워야 첫 프레임부터
 * 제대로 나온다. DOM 쪽은 늦게 와도 알아서 다시 그리므로 문제되지 않는다.
 *
 * **크기를 고르는 기준**
 * 픽셀 폰트는 설계 크기의 정수배에서만 선명하다. Galmuri11은 11·22px, Galmuri7은
 * 7·14px에서 또렷하고, 그 사이 값(13px 등)은 뭉갠다. 그래서 HUD/월드의 글자 크기를
 * 전부 이 배수에 맞춰뒀다(HudScene, playerSprite 참고).
 */

export interface FontAsset {
  family: string;
  /** public/ 기준 경로 */
  path: string;
  weight: string;
}

export const GAME_FONTS: FontAsset[] = [
  { family: 'Galmuri11', path: 'assets/fonts/Galmuri11.woff2', weight: '400' },
  { family: 'Galmuri11', path: 'assets/fonts/Galmuri11-Bold.woff2', weight: '700' },
  // 월드 안 닉네임처럼 아주 작게 쓰는 자리용. 11px짜리를 줄이면 획이 뭉개진다.
  { family: 'Galmuri7', path: 'assets/fonts/Galmuri7.woff2', weight: '400' },
];

/**
 * 앱 시작 시 한 번 호출한다. 파일이 없거나 로드에 실패하면 조용히 건너뛴다 —
 * 폰트가 없어도 게임은 폴백(system monospace)으로 떠야 한다.
 */
export async function loadGameFonts(): Promise<void> {
  if (typeof FontFace === 'undefined') return;

  await Promise.all(
    GAME_FONTS.map(async (font) => {
      try {
        const face = new FontFace(font.family, `url('${resolveAssetUrl(font.path)}')`, {
          weight: font.weight,
          style: 'normal',
        });
        await face.load();
        document.fonts.add(face);
      } catch {
        // 폰트 하나가 실패해도 나머지는 계속 등록한다.
      }
    }),
  );
}

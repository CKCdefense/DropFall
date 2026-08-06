/**
 * DOM UI가 쓰는 이미지 에셋 등록.
 *
 * **경로를 CSS에 직접 쓰지 않고 여기서 주입하는 이유**
 * 이 파일들은 `public/`에 있어서 Vite가 경로를 재작성해주지 않는다. CSS에
 * `url('/assets/...')`처럼 절대경로를 쓰면 GitHub Pages 하위경로(`/DropFall/`)에서 깨진다.
 * `import.meta.env.BASE_URL`을 붙여 런타임에 CSS 변수로 넣으면 Pages와 홈서버 양쪽에서
 * 같은 빌드가 동작한다. (docs/02-tech-spec.md §9.4)
 *
 * **없으면 플레이스홀더로 남는다**
 * 에셋이 하나씩 들어오는 단계라, 파일이 아직 없으면 조용히 건너뛰고 기존 플레이스홀더를
 * 그대로 쓴다. 파일을 넣고 새로고침하면 자동으로 반영된다 — 코드 수정이 필요 없다.
 */

export interface ImageAsset {
  /** 적용할 CSS 변수 (tokens.css에 기본값 none으로 선언돼 있다) */
  cssVar: string;
  /** public/ 기준 경로 */
  path: string;
  /** 로드 성공 시 <html>에 붙일 클래스 (CSS에서 "에셋이 있을 때만" 분기용) */
  htmlClass?: string;
}

export const IMAGE_ASSETS = {
  logo: { cssVar: '--asset-logo', path: 'assets/ui/logo_title.png' },
  landingBackground: {
    cssVar: '--asset-landing-bg',
    path: 'assets/ui/bg_landing.png',
    htmlClass: 'has-landing-bg',
  },
  /** 모달 외곽 9-slice 프레임 */
  modal: { cssVar: '--asset-modal', path: 'assets/ui/title_modal.png' },
  /** 입력창 9-slice 프레임 */
  input: { cssVar: '--asset-input', path: 'assets/ui/input.png' },
  inputHover: { cssVar: '--asset-input-hover', path: 'assets/ui/input_hover.png' },
  /** 버튼 9-slice 프레임 */
  button: { cssVar: '--asset-button', path: 'assets/ui/btn_stone.png' },
  buttonHover: { cssVar: '--asset-button-hover', path: 'assets/ui/btn_stone_hover.png' },
} as const satisfies Record<string, ImageAsset>;

/**
 * 기본 상태 에셋만 있고 hover 변형이 없으면, hover에도 기본 에셋을 쓴다.
 * 이걸 안 하면 hover 시 border-image-source가 none이 되어 테두리가 사라진다.
 */
const HOVER_FALLBACKS: [hover: ImageAssetKey, base: ImageAssetKey][] = [
  ['inputHover', 'input'],
  ['buttonHover', 'button'],
];

/**
 * 9-slice 에셋이 적용된 요소에 붙일 속성.
 * `data-asset`이 있으면 플레이스홀더용 외곽선 규칙(`:not([data-asset])`)이 꺼진다.
 */
export function assetAttr(key: ImageAssetKey): Record<string, string> {
  return hasAsset(key) ? { 'data-asset': '' } : {};
}

export type ImageAssetKey = keyof typeof IMAGE_ASSETS;

const available = new Set<ImageAssetKey>();

/** BASE_URL을 붙여 Pages 하위경로/홈서버 루트 양쪽에서 통하는 URL을 만든다. */
export function resolveAssetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/** 앱 시작 시 한 번 호출한다. 존재하는 에셋만 CSS 변수로 등록된다. */
export async function loadImageAssets(): Promise<void> {
  const entries = Object.entries(IMAGE_ASSETS) as [ImageAssetKey, ImageAsset][];

  await Promise.all(
    entries.map(async ([key, asset]) => {
      const url = resolveAssetUrl(asset.path);
      if (!(await probe(url))) return;

      document.documentElement.style.setProperty(asset.cssVar, `url('${url}')`);
      if (asset.htmlClass) document.documentElement.classList.add(asset.htmlClass);
      available.add(key);
    }),
  );

  for (const [hover, base] of HOVER_FALLBACKS) {
    if (available.has(hover) || !available.has(base)) continue;
    const url = resolveAssetUrl(IMAGE_ASSETS[base].path);
    document.documentElement.style.setProperty(IMAGE_ASSETS[hover].cssVar, `url('${url}')`);
    available.add(hover);
  }
}

export function hasAsset(key: ImageAssetKey): boolean {
  return available.has(key);
}

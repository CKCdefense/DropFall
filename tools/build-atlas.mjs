#!/usr/bin/env node
/**
 * 에셋 빌드 — assets/ 원본을 packages/client/public/assets/ 산출물로 만든다.
 *
 *   pnpm build:atlas
 *   ASEPRITE="D:/Apps/Aseprite/Aseprite.exe" pnpm build:atlas   # 경로가 다를 때
 *
 * 하는 일
 *  1. assets/atlas.config.json 의 atlases 항목마다 Aseprite CLI로 아틀라스(PNG+JSON) 생성
 *  2. copy 항목을 산출물 디렉터리로 복사 (9-slice PNG, 맵, 오디오, 폰트)
 *
 * 원본이 아직 없으면 조용히 건너뛴다 — 에셋이 하나도 없는 지금도 실행 가능해야 한다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets');
const OUT = join(ROOT, 'packages/client/public/assets');

/** 아틀라스 프레임 이름 규칙: {파일명}_{태그}_{태그내프레임번호} (assets/README.md 참고) */
const FILENAME_FORMAT = '{title}_{tag}_{tagframe}';

const ASEPRITE_CANDIDATES = [
  process.env.ASEPRITE,
  'C:/Program Files (x86)/Steam/steamapps/common/Aseprite/Aseprite.exe',
  'C:/Program Files/Aseprite/Aseprite.exe',
  '/Applications/Aseprite.app/Contents/MacOS/aseprite',
  'aseprite',
].filter(Boolean);

function findAseprite() {
  for (const candidate of ASEPRITE_CANDIDATES) {
    if (candidate === 'aseprite' || existsSync(candidate)) return candidate;
  }
  return null;
}

/** 디렉터리를 재귀적으로 훑어 확장자가 맞는 파일 경로를 모은다. */
function collect(dir, extensions) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collect(full, extensions));
    } else if (extensions.includes(extname(entry).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 아틀라스에 넣을 원본 확장자.
 * Aseprite CLI는 PNG도 입력으로 받는다 — 애니메이션이 없는 단일 이미지(무기, 아이콘 등)는
 * .aseprite로 만들 이유가 없어서 PNG를 그대로 허용한다.
 * 다만 PNG에는 태그 개념이 없어 프레임 이름이 `{파일명}__0`(밑줄 2개)이 된다.
 */
const SPRITE_EXTENSIONS = ['.aseprite', '.ase', '.png'];

function buildAtlas(aseprite, atlas) {
  const files = atlas.sources.flatMap((source) => collect(join(SRC, source), SPRITE_EXTENSIONS));

  if (files.length === 0) {
    console.log(`  - ${atlas.name}: 원본 없음, 건너뜀`);
    return;
  }

  const outDir = join(OUT, 'atlas');
  mkdirSync(outDir, { recursive: true });

  const sheet = join(outDir, `${atlas.name}.png`);
  const data = join(outDir, `${atlas.name}.json`);

  execFileSync(
    aseprite,
    [
      '-b',
      ...files,
      '--sheet-type',
      'packed',
      '--sheet',
      sheet,
      '--data',
      data,
      '--format',
      'json-hash',
      '--filename-format',
      FILENAME_FORMAT,
      '--list-tags',
      // --trim은 쓰지 않는다. 프레임마다 크기가 달라져 원점(캐릭터는 발밑 중앙) 계산이
      // 복잡해지고, 16/32px 격자에 맞춘 픽셀아트에서는 정렬이 어긋나기 쉽다.
      // 아틀라스가 조금 커지지만 이 규모에서는 문제되지 않는다.
      '--shape-padding',
      '1', // 확대 시 이웃 프레임이 새어드는 것(텍스처 블리딩) 방지
    ],
    { stdio: 'inherit' },
  );

  console.log(`  - ${atlas.name}: ${files.length}개 원본 → ${atlas.name}.png / .json`);
}

function copyGroup(group) {
  const from = join(SRC, group.from);
  const extensions = group.extensions ?? ['.png'];
  let files = collect(from, extensions);

  // include가 있으면 그 파일만 복사한다. 폰트처럼 원본 디렉터리에 변형이 잔뜩 들어 있고
  // 실제로 쓰는 건 몇 개뿐인 경우, 전부 복사하면 산출물이 수 MB씩 불어난다.
  if (group.include) {
    const wanted = new Set(group.include);
    files = files.filter((file) => wanted.has(basename(file)));
  }

  if (files.length === 0) {
    console.log(`  - ${group.from}: 원본 없음, 건너뜀`);
    return;
  }

  const to = join(OUT, group.to);
  mkdirSync(to, { recursive: true });
  for (const file of files) copyFileSync(file, join(to, file.split(/[\\/]/).pop()));

  console.log(`  - ${group.from} → assets/${group.to}: ${files.length}개`);
}

function main() {
  const config = JSON.parse(readFileSync(join(SRC, 'atlas.config.json'), 'utf8'));

  console.log('[atlas] 아틀라스 생성');
  const hasSources = config.atlases.some((atlas) =>
    atlas.sources.some((source) => collect(join(SRC, source), SPRITE_EXTENSIONS).length > 0),
  );

  if (!hasSources) {
    console.log('  - 스프라이트 원본이 아직 없다. 아틀라스 생성을 건너뛴다.');
  } else {
    const aseprite = findAseprite();
    if (!aseprite) {
      console.error(
        '\n[atlas] Aseprite CLI를 찾지 못했다.\n' +
          '  설치 후 다시 실행하거나, 경로를 직접 지정한다:\n' +
          '    ASEPRITE="D:/Apps/Aseprite/Aseprite.exe" pnpm build:atlas\n' +
          '  (산출물은 커밋되므로, 에셋을 만들지 않는 팀원은 이 명령이 필요 없다)\n',
      );
      process.exit(1);
    }
    console.log(`  Aseprite: ${aseprite}`);
    for (const atlas of config.atlases) buildAtlas(aseprite, atlas);
  }

  console.log('[atlas] 개별 파일 복사');
  for (const group of config.copy) copyGroup(group);

  console.log('[atlas] 완료');
}

main();

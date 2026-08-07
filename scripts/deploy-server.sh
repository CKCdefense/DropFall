#!/usr/bin/env bash
# 개인 서버(홈서버)에서 직접 실행되는 배포 스크립트. CI(.github/workflows/deploy-server.yml)가
# Tailscale 경유 SSH로 이 스크립트를 원격 실행시킬 뿐, CI 쪽에서 빌드 산출물을 옮기지 않는다 —
# 서버가 최신 main을 직접 받아 자기 환경(Node/pnpm)으로 빌드한다(docs/07-deployment.md).
#
# 최초 1회는 사람이 직접 실행해서 정상 동작을 확인해 둘 것 — CI 실패 시 원인이
# 이 스크립트인지 워크플로/시크릿 설정인지 구분하기 쉬워진다.
set -euo pipefail

# SSH로 비대화형 실행될 때는 ~/.bashrc가 안 읽혀서 PATH에 pnpm이 안 잡힌다
# (get.pnpm.io standalone 설치 위치). 로그인 계정마다 값이 같지 않을 수 있어
# 두 후보 경로를 모두 넣어 둔다.
#
# corepack은 이 서버(Node 22.22.1 + Ubuntu apt corepack 0.24.0 조합)에서
# ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING으로 아예 못 쓴다 — corepack을 거치지
# 않는 standalone pnpm(get.pnpm.io/install.sh)으로 대체했다(docs/07-deployment.md).
export PATH="$HOME/.local/share/pnpm:$HOME/.local/share/pnpm/bin:$PATH"

cd /srv/dropfall

git fetch origin
git reset --hard origin/main

pnpm install --frozen-lockfile

# @dropfall/shared는 별도 빌드 산출물이 없는 순수 TS 소스라 tsup이 직접
# 인라인한다 — "shared 먼저 빌드"가 필요 없다.
pnpm --filter @dropfall/server build

# 이 스크립트를 실행하는 deploy 계정은 systemctl 전체가 아니라 이 재시작
# 명령 하나만 암호 없이 허용해야 한다 — sudoers에 정확히 이 줄만 추가한다
# (docs/07-deployment.md — visudo로 "deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart dropfall-server").
sudo systemctl restart dropfall-server

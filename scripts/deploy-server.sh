#!/usr/bin/env bash
# 개인 서버(홈서버)에서 직접 실행되는 배포 스크립트. CI(.github/workflows/deploy-server.yml)가
# Tailscale 경유 SSH로 이 스크립트를 원격 실행시킬 뿐, CI 쪽에서 빌드 산출물을 옮기지 않는다 —
# 서버가 최신 main을 직접 받아 자기 환경(Node/pnpm)으로 빌드한다(docs/07-deployment.md).
#
# 최초 1회는 사람이 직접 실행해서 정상 동작을 확인해 둘 것 — CI 실패 시 원인이
# 이 스크립트인지 워크플로/시크릿 설정인지 구분하기 쉬워진다.
set -euo pipefail

cd /srv/dropfall

git fetch origin
git reset --hard origin/main

# packageManager 필드(package.json: pnpm@11.18.0)를 Corepack이 그대로 읽는다.
corepack enable
pnpm install --frozen-lockfile

# @dropfall/shared는 별도 빌드 산출물이 없는 순수 TS 소스라 tsup이 직접
# 인라인한다 — "shared 먼저 빌드"가 필요 없다.
pnpm --filter @dropfall/server build

# 이 스크립트를 실행하는 deploy 계정은 systemctl 전체가 아니라 이 재시작
# 명령 하나만 암호 없이 허용해야 한다 — sudoers에 정확히 이 줄만 추가한다
# (docs/07-deployment.md — visudo로 "deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart dropfall-server").
sudo systemctl restart dropfall-server

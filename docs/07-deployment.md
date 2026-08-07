# 배포 — GitHub Pages(클라이언트) + 개인 서버 SSH(게임 서버)

> 전체 구조/설계 근거는 [02-tech-spec.md §9](02-tech-spec.md)에 이미 정리돼
> 있다. 이 문서는 그걸 실제로 돌리기 위한 **한 번만 하면 되는 서버 최초
> 설정**과, `main` 머지마다 자동으로 도는 CI/CD 워크플로 2개를 설명한다.

**"개인 서버 SSH"와 "wss:// 공개 노출"은 별개다** — 헷갈리기 쉬워서 먼저
짚는다:
- **CI가 서버에 배포하려고 접속하는 경로**: GitHub Actions 러너가
  Tailscale에 임시로 조인해서, 서버의 tailnet 주소로 SSH 접속한다. 이건
  "CI → 서버" 한 방향, 배포할 때만 잠깐 쓰는 경로다.
- **플레이어(GitHub Pages)가 실제로 게임 서버에 접속하는 경로**: Tailscale과
  무관하다. GitHub Pages는 항상 HTTPS라 브라우저가 `ws://`(비암호화)를
  차단하므로, 서버는 **Cloudflare Tunnel**로 `wss://game.<도메인>`을 공개
  노출해야 한다(tech spec §9.3). Tailscale은 tailnet 밖(심사위원, 외부
  플레이어)에서는 안 닿는다 — 배포용으로만 쓰고 플레이 트래픽에는 안 쓴다.

## 1. 서버 최초 설정 (한 번만)

서버에 Node 20+, git, Tailscale이 이미 설치·연결돼 있다고 가정한다.

> **계정 구성**: 원래는 서비스 실행용(`dropfall`)과 CI 배포용(`deploy`)
> 계정을 분리하는 걸 권장했지만, 팀/서버 규모상 **로그인 계정 하나
> (`dosl196122`)로 통일**했다 — 서비스도 이 계정으로 돌고, CI도 이 계정으로
> SSH 접속한다. 아래 계정명은 실제 서버 계정으로 그대로 대입한 것이다.

```bash
# 1) /srv/dropfall을 내 계정 소유로 만들고 저장소를 받는다
#    (/srv는 기본적으로 root 소유라 clone 전에 소유권부터 넘겨받아야 한다)
sudo mkdir -p /srv/dropfall
sudo chown "$USER":"$USER" /srv/dropfall
git clone https://github.com/CKCdefense/DropFall.git /srv/dropfall
cd /srv/dropfall
corepack enable   # 이미 sudo corepack enable로 활성화했다면 생략해도 된다
pnpm install --frozen-lockfile
pnpm --filter @dropfall/server build

# 2) 배포 스크립트로 재시작할 권한만 얻는다(전체 sudo 아님)
#    sudo visudo 로 아래 한 줄만 추가(계정명은 실제 로그인 계정으로):
#    dosl196122 ALL=(root) NOPASSWD: /usr/bin/systemctl restart dropfall-server

# 3) systemd 서비스 등록 (deploy/dropfall-server.service, 이 리포에 커밋돼 있음)
sudo cp deploy/dropfall-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dropfall-server
sudo systemctl status dropfall-server   # active (running) 확인

# 4) 재부팅 테스트 — 반드시 한 번 실제로 해 볼 것(tech spec §9.7)
sudo reboot
# 재접속 후: systemctl status dropfall-server 로 자동 기동 확인
```

민감/환경별 값(`CLIENT_ORIGIN`, `CORE_PERSONA_ANTHROPIC_API_KEY` 등)은
서버의 `packages/server/.env`에 직접 적는다 — 이 파일은
`.gitignore` 처리돼 있어 리포에 안 들어간다. `packages/server/src/index.ts`가
기동 시 `process.loadEnvFile()`로 자동으로 읽는다.

`scripts/deploy-server.sh`(이 리포에 커밋돼 있음)를 한 번 수동으로 실행해서
정상 동작을 확인해 둔다 — 이후 CI가 실행하는 것과 완전히 같은 스크립트다.

## 2. Cloudflare Tunnel (wss:// 공개 노출)

tech spec §9.3의 예시를 그대로 쓴다:

```yaml
# ~/.cloudflared/config.yml
tunnel: dropfall
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: game.<도메인>
    service: http://localhost:2567
  - service: http_status:404
```

`cloudflared`도 systemd 서비스로 등록해서 `Restart=always` + 부팅 자동
기동을 걸어 둔다(`cloudflared service install` 명령이 이 유닛을 대신
만들어준다).

## 3. Tailscale — CI 배포 접속용

1. [Tailscale 관리자 콘솔](https://login.tailscale.com/admin/settings/oauth) →
   **OAuth clients**에서 새 client 발급. 태그(예: `tag:ci`)를 하나 지정한다 —
   CI가 조인할 때마다 임시 노드에 이 태그가 붙는다.
2. **ACL**(관리자 콘솔 → Access Controls)에서 `tag:ci`가 배포 서버(SSH 포트)에
   닿을 수 있게 규칙을 추가한다. 예:
   ```json
   "acls": [
     { "action": "accept", "src": ["tag:ci"], "dst": ["<서버-tailscale-ip>:22"] }
   ]
   ```
3. 서버의 Tailscale 주소(IP 또는 MagicDNS 이름, `tailscale ip -4`나
   관리자 콘솔에서 확인)를 아래 GitHub 변수 `TS_SERVER_HOST`에 쓴다.

## 4. 배포 전용 SSH 키

CI 전용 키페어를 새로 만든다(로컬 계정 키를 재사용하지 않는다):

```bash
ssh-keygen -t ed25519 -f dropfall_deploy_key -N ""
# 공개키 → 서버의 배포 계정(예: dosl196122)에 등록
ssh-copy-id -i dropfall_deploy_key.pub dosl196122@<서버-tailscale-ip>
# 개인키(dropfall_deploy_key) 내용을 GitHub 시크릿 DEPLOY_SSH_KEY에 붙여넣고,
# 로컬 사본은 지운다.
```

## 5. GitHub 리포지토리 설정

**Settings → Pages → Build and deployment → Source**: "GitHub Actions"로
변경(이 저장소 설정은 코드로 자동화할 수 없다 — 직접 클릭).

**Settings → Secrets and variables → Actions**:

| 종류 | 이름 | 값 | 용도 |
|---|---|---|---|
| Secret | `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client id | CI가 tailnet에 조인 |
| Secret | `TS_OAUTH_CLIENT_SECRET` | Tailscale OAuth client secret | 〃 |
| Secret | `DEPLOY_SSH_KEY` | §4에서 만든 개인키 전체 내용 | 서버 SSH 접속 |
| Variable | `DEPLOY_SSH_USER` | `dosl196122`(서버 로그인 계정) | SSH 접속 계정 |
| Variable | `TS_SERVER_HOST` | 서버의 Tailscale IP/MagicDNS 이름 | SSH 접속 대상 |
| Variable | `VITE_SERVER_URL` | `wss://game.<도메인>` | 클라이언트 빌드에 굽는 서버 주소 |

## 6. 워크플로 요약

| 파일 | 트리거 | 하는 일 |
|---|---|---|
| `.github/workflows/deploy-pages.yml` | `main` push | 검증(shared 테스트/client typecheck/lint) → `pnpm --filter @dropfall/client build` → GitHub Pages 배포 |
| `.github/workflows/deploy-server.yml` | `main` push | 검증(shared 테스트/server typecheck/lint) → Tailscale 조인 → SSH로 `scripts/deploy-server.sh` 원격 실행(서버가 직접 git pull + 빌드 + `systemctl restart`) |

둘 다 `workflow_dispatch`로 Actions 탭에서 수동 재실행도 가능하다.

## 7. 배포 체크리스트 (tech spec §9.7과 동일)

- [ ] 팀 외부 네트워크(모바일 핫스팟 등)에서 Pages URL 접속 → 서버 연결 성공
- [ ] 3인 동시 접속 20분 이상 유지(Cloudflare WebSocket 타임아웃 실측)
- [ ] 서버 **재부팅 후** `dropfall-server` + `cloudflared` 자동 기동 확인
- [ ] 로비 장시간 대기 → 연결 유지 확인
- [ ] 브라우저 콘솔에 mixed content / 404 에셋 경고 없음
- [ ] `main`에 더미 커밋을 머지해서 두 워크플로가 실제로 초록불로 끝나는지 확인

## 8. 범위 밖 (다음 작업)

- 홈서버 정적 클라이언트 이중화(tech spec의 "클라이언트 (부)") — 지금은
  GitHub Pages 단일 배포만 자동화돼 있다. 필요해지면 `deploy-server.yml`에
  `rsync dist/ deploy@...:/srv/dropfall-static/`류 스텝을 추가하면 된다.
- 워크플로 YAML은 이 환경에 `actionlint`가 없어 완전한 로컬 검증이
  불가능했다 — 커밋 후 Actions 탭 실행 결과로 최종 확인할 것.

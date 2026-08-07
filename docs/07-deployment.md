# 배포 — GitHub Pages(클라이언트) + 개인 서버 SSH(게임 서버)

> 전체 구조/설계 근거는 [02-tech-spec.md §9](02-tech-spec.md)에 이미 정리돼
> 있다. 이 문서는 그걸 실제로 돌리기 위한 **한 번만 하면 되는 서버 최초
> 설정**과, `main` 머지마다 자동으로 도는 CI/CD 워크플로 2개를 설명한다.

**"개인 서버 SSH"와 "wss:// 공개 노출"은 목적이 다르다** — 둘 다 결국
Tailscale을 쓰지만(원래 계획은 배포용 Tailscale + 공개 노출용 Cloudflare
Tunnel로 분리하려 했으나, 도메인이 없어 Cloudflare Tunnel을 못 써서
Tailscale Funnel로 대체했다 — §2), 성격이 전혀 다르니 헷갈리지 않게 먼저
짚는다:
- **CI가 서버에 배포하려고 접속하는 경로**: GitHub Actions 러너가
  Tailscale에 **임시로** 조인해서(`tag:ci`, 실행할 때만 존재), 서버의
  tailnet 주소로 **SSH**(포트 22) 접속한다. "CI → 서버" 한 방향, 배포할
  때만 잠깐 쓰는 경로다 — tailnet 밖에서는 안 닿는다.
- **플레이어가 실제로 게임 서버(wss://)에 접속하는 경로**: 서버가 이미
  tailnet에 상시 조인돼 있는 걸 이용해 **Tailscale Funnel**로 포트 2567을
  공개 인터넷에 노출한다(§2). 이건 tailnet 안팎 상관없이 **누구나** 접속
  가능한, 완전히 공개된 경로다 — SSH 배포 경로와는 인증/접근 범위가
  전혀 다르다.

## 1. 서버 최초 설정 (한 번만)

서버에 Node 22.13+(pnpm 11이 요구하는 최소 버전, `package.json`의
`engines.node` 참고), git, Tailscale이 이미 설치·연결돼 있다고 가정한다.

> **계정 구성**: 원래는 서비스 실행용(`dropfall`)과 CI 배포용(`deploy`)
> 계정을 분리하는 걸 권장했지만, 팀/서버 규모상 **로그인 계정 하나로
> 통일**했다 — 서비스도 이 계정으로 돌고, CI도 이 계정으로 SSH 접속한다.
> 아래 `<서버-계정명>`은 실제 서버 로그인 계정으로 바꿔서 쓴다(계정명
> 자체가 민감 정보는 아니지만, public 저장소라 굳이 실명을 문서에 남기지
> 않는다).

> **corepack 대신 standalone pnpm을 쓴다**: Ubuntu apt로 깔리는 corepack
> (실측 0.24.0)이 Node 22.x와 조합되면 pnpm 실행 시
> `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`으로 죽는다(corepack 내부의 VM
> 샌드박스가 동적 import를 못 다룸 — corepack 최신판도 Node 22.22.2+를
> 요구해서 이 문제를 피해가지 못했다). [get.pnpm.io](https://pnpm.io/installation#using-a-standalone-script)
> 설치 스크립트로 corepack을 거치지 않는 독립 실행 pnpm을 쓴다 —
> `package.json`의 `packageManager` 필드를 pnpm 스스로 읽어서 맞는
> 버전으로 알아서 맞춰 준다.

```bash
# 1) /srv/dropfall을 내 계정 소유로 만들고 저장소를 받는다
#    (/srv는 기본적으로 root 소유라 clone 전에 소유권부터 넘겨받아야 한다)
sudo mkdir -p /srv/dropfall
sudo chown "$USER":"$USER" /srv/dropfall
git clone https://github.com/CKCdefense/DropFall.git /srv/dropfall
cd /srv/dropfall

# corepack이 아니라 standalone pnpm — 위 안내 참고
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc   # PATH에 pnpm 반영 (비대화형 SSH 실행 시는
                    # scripts/deploy-server.sh가 PATH를 직접 지정한다)

pnpm install --frozen-lockfile
pnpm --filter @dropfall/server build

# 2) 배포 스크립트로 재시작할 권한만 얻는다(전체 sudo 아님)
#    sudo visudo 로 아래 한 줄만 추가(계정명은 실제 로그인 계정으로):
#    <서버-계정명> ALL=(root) NOPASSWD: /usr/bin/systemctl restart dropfall-server

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
기동 시 `process.loadEnvFile()`로 자동으로 읽는다(systemd
`EnvironmentFile=`도 같은 파일을 읽으므로 형식은 그대로 `KEY=VALUE`).

> **`CLIENT_ORIGIN`은 프로덕션에서 사실상 필수다.** 코드
> (`allowedOrigin = process.env.CLIENT_ORIGIN ?? (isProduction ? '' : '*')`)의
> 의도는 "프로덕션 기본값은 전체 차단"이지만, 값이 없을 때 우리 미들웨어가
> CORS 헤더 자체를 건드리지 않고 넘어가는 바람에 Express/Colyseus가 자체
> 기본으로 붙이는 `Access-Control-Allow-Origin: *`가 그대로 노출된다(실제
> 배포 중 `curl`로 확인된 문제 — 코드 로직 자체를 고치는 건 별도 후속
> 작업으로 남겨 둠). `.env`에 `CLIENT_ORIGIN=https://<Pages 오리진>`
> (경로 없이 scheme+host만)을 반드시 넣어서 막아 둔다.

`scripts/deploy-server.sh`(이 리포에 커밋돼 있음)를 한 번 수동으로 실행해서
정상 동작을 확인해 둔다 — 이후 CI가 실행하는 것과 완전히 같은 스크립트다.

## 2. Tailscale Funnel (wss:// 공개 노출)

원래 계획은 Cloudflare Tunnel(tech spec §9.3 원안)이었지만, 실제로 시도해
보니 **Cloudflare Tunnel의 공개 호스트네임 라우팅은 우리가 DNS를 소유한
루트 도메인이 있어야만 동작**한다 — 무료 서브도메인 서비스(`kro.kr` 등)는
Public Suffix List에 올라간 공유 도메인이라 Cloudflare가 "소유한 루트
도메인"으로 인정하지 않는다(`cloudflared tunnel login` 화면에 zone
목록이 비어서 진행 자체가 막힘). 도메인을 새로 사지 않기로 하고
**Tailscale Funnel**로 바꿨다 — §1에서 서버가 이미 Tailscale에 연결돼
있으니 추가 계정/도메인/카드 없이 그대로 쓸 수 있다.

```bash
# 1) tailnet 전체 설정(한 번만, Tailscale 관리자 콘솔에서)
#    https://login.tailscale.com/admin/dns → HTTPS Certificates 켜기

# 2) 서버에서 로컬 포트를 공개 인터넷에 노출
sudo tailscale funnel 2567
# 최초 실행 시 "Funnel is not enabled on your tailnet" 안내와 함께
# 승인 링크(https://login.tailscale.com/f/funnel?node=...)가 뜬다 —
# 브라우저로 열어서 한 번만 승인하면 이후엔 바로 활성화된다.

# 3) 확인
sudo tailscale funnel status
# https://<머신명>.<tailnet-이름>.ts.net 로 공개 접속 가능(TLS 자동)
```

`tailscale funnel` 설정은 tailscaled 자체(로컬 상태)에 저장되므로 서버
재부팅 후에도 별도 조치 없이 유지된다 — `cloudflared`처럼 따로 systemd
유닛을 만들 필요가 없다. 호스트네임(`<머신명>.<tailnet-이름>.ts.net`)도
고정이라 Cloudflare Quick Tunnel(매 실행마다 무작위 주소 발급)과 달리
`Restart=always` 자동 복구 설계와 잘 맞는다.

> 실제 확인된 예시: `wss://lab.tailcecca7.ts.net` — 외부 네트워크에서
> `curl -i https://lab.tailcecca7.ts.net/`로 `404`(Express가 루트 경로에
> 라우트를 안 둬서 정상) 응답을 받으면 공개 노출이 정상 동작하는 것이다.

## 3. Tailscale — CI 배포 접속용

서버 자신이 tailnet에 조인해 있는 것(§1 전제, §2에서 Funnel에도 재사용)과
별개로, **CI가 배포 때만 잠깐 조인하는 통로**를 추가로 설정한다.

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
# 공개키 → 서버의 배포 계정에 등록
ssh-copy-id -i dropfall_deploy_key.pub <서버-계정명>@<서버-tailscale-ip>
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
| Variable | `DEPLOY_SSH_USER` | 서버 로그인 계정명 | SSH 접속 계정 |
| Variable | `TS_SERVER_HOST` | 서버의 Tailscale IP/MagicDNS 이름 | SSH 접속 대상 |
| Variable | `VITE_SERVER_URL` | `wss://<머신명>.<tailnet-이름>.ts.net` (§2, 예: `wss://lab.tailcecca7.ts.net`) | 클라이언트 빌드에 굽는 서버 주소 |

## 6. 워크플로 요약

| 파일 | 트리거 | 하는 일 |
|---|---|---|
| `.github/workflows/deploy-pages.yml` | `main` push | 검증(shared 테스트/client typecheck/lint) → `pnpm --filter @dropfall/client build` → GitHub Pages 배포 |
| `.github/workflows/deploy-server.yml` | `main` push | 검증(shared 테스트/server typecheck/lint) → Tailscale 조인 → SSH로 `scripts/deploy-server.sh` 원격 실행(서버가 직접 git pull + 빌드 + `systemctl restart`) |

둘 다 `workflow_dispatch`로 Actions 탭에서 수동 재실행도 가능하다.

## 7. 배포 체크리스트 (tech spec §9.7과 동일)

- [ ] 팀 외부 네트워크(모바일 핫스팟 등)에서 Pages URL 접속 → 서버 연결 성공
- [ ] 3인 동시 접속 20분 이상 유지(WebSocket 유휴 타임아웃 실측)
- [ ] 서버 **재부팅 후** `dropfall-server` 자동 기동 + `tailscale funnel status`로 Funnel 유지 확인
- [ ] 로비 장시간 대기 → 연결 유지 확인
- [ ] 브라우저 콘솔에 mixed content / 404 에셋 경고 없음
- [ ] `main`에 더미 커밋을 머지해서 두 워크플로가 실제로 초록불로 끝나는지 확인

## 8. 범위 밖 (다음 작업)

- 홈서버 정적 클라이언트 이중화(tech spec의 "클라이언트 (부)") — 지금은
  GitHub Pages 단일 배포만 자동화돼 있다. 필요해지면 `deploy-server.yml`에
  `rsync dist/ deploy@...:/srv/dropfall-static/`류 스텝을 추가하면 된다.
- 워크플로 YAML은 이 환경에 `actionlint`가 없어 완전한 로컬 검증이
  불가능했다 — 커밋 후 Actions 탭 실행 결과로 최종 확인할 것.

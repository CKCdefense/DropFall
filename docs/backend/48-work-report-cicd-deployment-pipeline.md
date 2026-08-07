# 작업 보고서 — CI/CD 구축: GitHub Pages(클라) + 개인 서버 SSH(게임 서버) 자동 배포

> `main` 머지 시 클라이언트는 GitHub Pages에, 게임 서버는 개인 홈서버에
> 자동 배포되는 파이프라인을 처음부터 구축했다. 설계 자체보다 **실제
> 서버에 처음 적용하는 과정에서 튀어나온 환경 문제**(Node 버전, corepack,
> sudoers, SSH 키 인코딩, 잘못된 액션 입력 이름 등)를 하나씩 잡는 데
> 대부분의 시간이 들었다 — 로컬에서 완벽해 보이는 워크플로도 실서버
> 환경에서 돌려보기 전엔 끝난 게 아니라는 걸 반복적으로 확인했다.

---

## 1. 기획 — 무엇을, 왜

원문 요청: "이제 github pages로 client 프론트 부분 배포하고 server는
개인서버(tailscale연결됨)ssh에 배포하려고하거든? 작업도와줄래? main
브랜치에 merge되면 자동으로 배포하는 cicd 작업하려고해"

확인한 결정 사항:
- 서버 공개 노출(플레이어가 실제로 접속하는 경로)은 최초엔 tech spec
  §9.3에 계획돼 있던 **Cloudflare Tunnel**로 하기로 함
- Colyseus 프로세스 관리는 아직 없어서 systemd 유닛부터 새로 만듦
- "개인서버 SSH"는 **CI가 배포를 위해 서버에 접속하는 경로**(Tailscale)를
  말하는 것이고, 플레이어가 게임에 접속하는 경로(wss://)는 별개 —
  이 둘을 혼동하지 않는 게 설계의 핵심

**배포 전략**: CI가 빌드 산출물을 서버로 전송(rsync)하지 않는다. 서버가
**직접 git pull + 빌드**한다(tech spec §9.5가 이미 이 방식을 대안으로
열거해 뒀음) — CI 워크플로는 Tailscale로 서버에 SSH 접속해서, 서버에
미리 둔 배포 스크립트 하나(`scripts/deploy-server.sh`)를 실행시키기만
한다. 빌드 환경(Node/pnpm 버전)이 항상 서버 자신과 일치하고, 아티팩트
전송 로직이 따로 필요 없다.

## 2. 과정 — 어떻게 했나

### 2.1 워크플로 2개 + systemd 유닛 (초기 구현)

- `.github/workflows/deploy-pages.yml`: `main` push 시 검증(shared
  테스트/client typecheck/lint) → `pnpm --filter @dropfall/client build`
  (`VITE_SERVER_URL`을 GitHub Variable에서 주입) →
  `actions/upload-pages-artifact` → `actions/deploy-pages`.
- `.github/workflows/deploy-server.yml`: 검증 → `tailscale/github-action`으로
  러너를 tailnet에 임시 조인(`tag:ci`) → SSH로
  `bash /srv/dropfall/scripts/deploy-server.sh` 원격 실행.
- `deploy/dropfall-server.service`: `Restart=always`/`RestartSec=3`
  (백업 게임 서버를 두지 않기로 했으므로 자동 복구가 유일한 방어선,
  tech spec §9.1), `EnvironmentFile=-.../packages/server/.env`(민감값).

### 2.2 실서버 최초 설정 — 여기서부터 진짜 작업이 시작됐다

**Node 버전 불일치.** `main` 머지 후 실제로 워크플로가 자동 실행됐는데
둘 다 `actions/setup-node@v4` 단계에서 실패했다. 원인: `package.json`에
고정된 `packageManager: pnpm@11.18.0`이 Node **22.13+**를 요구하는데,
워크플로엔 `engines.node`(`>=20`)만 보고 `node-version: '20'`을 박아
뒀었다. `ERR_UNKNOWN_BUILTIN_MODULE`(`node:sqlite`, pnpm 11 내부가 Node
22의 내장 모듈에 의존)로 진단해서 `'22'`로 고쳤다.

**corepack이 이 서버에서 아예 못 뜬다.** Node를 22로 맞춰도 서버에서
`pnpm install`이 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`으로 죽었다 —
Ubuntu apt로 깔리는 corepack(실측 0.24.0)이 Node 22.x와 조합되면 VM
샌드박스가 동적 import를 못 다룬다. corepack 최신판도 Node 22.22.2+를
요구해 이 서버(22.22.1)에서 여전히 못 썼다. corepack을 거치지 않는
[get.pnpm.io standalone 설치](https://pnpm.io/installation#using-a-standalone-script)로
대체 — `package.json`의 `packageManager` 필드를 pnpm 스스로 읽어 맞는
버전으로 알아서 맞춘다. `scripts/deploy-server.sh`도 `corepack enable`을
빼고 standalone pnpm의 PATH를 직접 지정하도록 고쳤다(비대화형 SSH 실행은
`~/.bashrc`를 안 읽으므로).

**남아있던 root 소유 잔재물.** corepack 우회 전에 시도했던
`sudo npm install -g pnpm`이 `/usr/local/bin/pnpm`에 root 소유 심볼릭
링크를 남겨뒀다. 나중에 pnpm이 `packageManager` 핀을 맞추려고 이
심볼릭 링크를 스스로 관리(교체)하려다 `EACCES: permission denied,
unlink`로 또 죽었다 — 지워서 해결.

**sudoers NOPASSWD 규칙이 사실은 저장된 적이 없었다.** 서버에서 사람이
직접 `sudo systemctl ...`을 칠 때마다 성공해서 문제없다고 믿었는데,
실제로는 최근 `sudo` 사용의 15분 자격증명 캐시 덕에 통과됐던 것뿐이었다
— CI가 SSH로 실행하면(캐시 없는 새 세션) 진짜로 비밀번호를 요구했다.
`sudo visudo -f /etc/sudoers.d/dropfall-deploy`로 연 파일이 실제로는
빈 파일이었던 걸 뒤늦게 확인하고 다시 채워 넣었다.

### 2.3 GitHub Actions ↔ Tailscale 연동에서 잡은 버그 두 개

- **잘못된 액션 입력 이름**: `tailscale/github-action@v3`에 `oauth-client-secret`을
  넣었는데, 실제 입력 이름은 `oauth-secret`이었다. 존재하지 않는 입력은
  경고만 뜨고 조용히 무시돼서, 실제 필요한 `oauth-secret`이 비어
  `"OAuth identity empty"`로 실패했다 — 워크플로 실행 로그에서 정확한
  유효 입력 목록을 보고 확인.
- **SSH 개인키 손상**: 서버에서 `cat`으로 출력한 개인키를 사람이 복사해
  GitHub Secret에 붙여넣는 과정에서 줄바꿈이 깨져
  `Load key "deploy_key": error in libcrypto` + `Permission denied
  (publickey)`로 실패했다. 원본 PEM을 그대로 시크릿에 넣는 대신, 서버에서
  `base64 -w0`으로 한 줄짜리 문자열을 만들어 그 값을 시크릿에 넣고,
  워크플로는 `base64 -d`로 복원하도록 바꿨다 — 사람이 복사/붙여넣기하는
  과정에서 줄바꿈이 깨질 여지 자체를 없앴다.

### 2.4 계획이 틀어진 것 — Cloudflare Tunnel 무산, Tailscale Funnel로 전환

원래 계획(Cloudflare Tunnel)을 실제로 시도해보니 **공개 호스트네임
라우팅이 우리가 DNS를 소유한 루트 도메인 없이는 동작하지 않는다**는
걸 확인했다. 무료로 확보한 `dropfall.kro.kr`은 Public Suffix List에
올라간 공유 도메인이라 Cloudflare가 "소유한 루트 도메인"으로 인정하지
않는다(`cloudflared tunnel login`의 zone 선택 화면이 비어서 진행 자체가
막힘, Zero Trust 대시보드는 카드 등록을 요구해서 그쪽도 막힘). 새로
도메인을 사지 않기로 하고 **Tailscale Funnel**로 바꿨다 — 서버가 이미
CI 배포용으로 Tailscale에 연결돼 있어 추가 인프라 없이 그대로 쓸 수
있다. `sudo tailscale funnel 2567`로 계정당 한 번 승인 링크를 거치면
`https://<머신명>.<tailnet-이름>.ts.net`으로 고정 주소가 나온다(Quick
Tunnel과 달리 재시작해도 안 바뀜 — `Restart=always` 설계와 궁합이
맞음). 실제로 `wss://lab.tailcecca7.ts.net`으로 외부(내 쪽) 네트워크에서
접속 확인까지 마쳤다.

### 2.5 보안 검토 (public 저장소 전환에 맞춰)

리포가 public이라 별도로 점검했다:
- 서버 실 계정명이 배포 문서/systemd 유닛에 하드코딩돼 있던 것을
  `<서버-계정명>` 자리표시자로 제네릭화
- `.gitignore`에 SSH/TLS 키 패턴(`*.pem`, `*.key`, `id_rsa*`,
  `id_ed25519*`, `*_deploy_key*`) 추가 — 실수로 리포에 개인키가
  들어가는 걸 막는 안전망
- 그 과정에서 CORS 기본값 버그도 발견: `allowedOrigin = CLIENT_ORIGIN ??
  (isProduction ? '' : '*')`가 프로덕션에서 값이 없을 때 빈 문자열(falsy)이
  돼 우리 CORS 미들웨어가 헤더를 아예 안 건드리고 넘어가는 바람에,
  Express/Colyseus가 자체로 붙이는 `Access-Control-Allow-Origin: *`가
  그대로 노출되고 있었다(실제 `curl`로 확인). 임시로 서버 `.env`에
  `CLIENT_ORIGIN=https://ckcdefense.github.io`를 명시해서 막았다 — 코드
  로직 자체의 폴백 개선은 후속 과제로 남겼다.

## 3. 결과 — 검증

- 두 워크플로 모두 GitHub Actions에서 실제로 **success**로 끝나는 것까지
  확인(`main` push 트리거, 수동 재실행 아님).
- `wss://lab.tailcecca7.ts.net` 외부 접속 확인(별도 네트워크에서 curl).
- CORS는 `.env`의 `CLIENT_ORIGIN` 값으로 GitHub Pages 오리진만 허용되는
  것으로 확인.
- 서버 재부팅 테스트 통과(`dropfall-server` 자동 기동, Tailscale Funnel
  설정도 tailscaled 자체에 저장돼 재부팅 후에도 유지).

## 4. 다음 작업

- CORS 폴백 로직 자체(`allowedOrigin` 계산식)를 프로덕션에서 값이
  없으면 명시적으로 전체 차단하도록 고치는 것 — 지금은 `.env`로
  덮어서 안전하지만 근본 수정은 아니다.
- `docs/07-deployment.md`의 §7 배포 체크리스트(3인 동시 접속 20분 유지,
  로비 장시간 대기 등) 항목들의 실측은 아직 못 했다.
- Cloudflare Tunnel 관련 계획은 tech spec/deployment 문서에서 Tailscale
  Funnel로 이미 갱신해 뒀다(별도 커밋).

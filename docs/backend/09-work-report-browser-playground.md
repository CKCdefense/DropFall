# 작업 보고서 — 브라우저에서 직접 테스트 (Colyseus Playground)

> [08번 문서](08-work-report-connection-smoke-test.md)의 스모크 테스트는 Node.js 스크립트라
> 브라우저에서 눈으로 보는 건 아니었다. 사용자가 "웹에서 테스트는 아직 안 되냐"고 물어서,
> `packages/client`(Phaser 게임 클라이언트) 없이도 브라우저에서 룸 접속을 확인할 방법을 찾았다.

---

## 1. 기획 — 무엇을, 왜

게임 클라이언트(`packages/client`)는 아직 없고 다른 팀원 담당이라 지금 만들 수 없다. 그런데
"브라우저에서 실제로 되는지 보고 싶다"는 요구는 그것과 별개로 타당하다 — Colyseus가 정확히
이 용도의 공식 devtool을 제공한다: **Playground**. 게임 코드 없이 브라우저에서 룸 접속, 메시지
송수신, 상태 확인을 할 수 있는 개발용 웹 페이지다. 서버에 라우트 하나만 마운트하면 된다.

---

## 2. 과정 — 어떻게 했나

### 2.1 설치
`@colyseus/playground`의 peerDependencies가 `express`, `@colyseus/auth`, `@colyseus/core`를
요구해서 (zod만 optional) 셋 다 같이 설치했다.
```bash
pnpm add --filter @dropfall/server @colyseus/playground express @colyseus/auth
```
`pnpm peers check`로 문제없음 확인.

### 2.2 마운트
[packages/server/src/index.ts](../../packages/server/src/index.ts) — `defineServer`의
`express` 콜백에 라우트를 건다. 공식 문서가 "프로덕션에 노출 금지"라고 경고해서
`NODE_ENV=production`일 때는 아예 마운트하지 않도록 가드했다.

```ts
express: (app) => {
  if (!isProduction) {
    app.use('/playground', playground());
  }
},
```

### 2.3 검증
서버를 띄우고 `curl`로 실제 응답을 확인했다. 처음엔 `/playground`가 301(트레일링 슬래시로
리다이렉트)을 줘서, 리다이렉트를 따라가 `/playground/`에서 실제 Playground SPA HTML
(`title: [Colyseus Playground]`)이 오는 것까지 확인했다.

### 겪은 문제
이전 스모크 테스트(08번 문서) 때 띄웠던 서버 프로세스가 완전히 안 죽어서 `EADDRINUSE`가 났다.
PowerShell로 2567 포트를 점유한 PID를 찾아서 정리하고 재시작했다. (참고: 백그라운드로 띄운
Node 프로세스는 터미널을 닫아도 안 죽을 수 있다 — `Get-NetTCPConnection -LocalPort 2567`로
확인 후 `Stop-Process`하는 게 확실하다.)

---

## 3. 결과 — 검증

```bash
curl -sL -o /dev/null -w "%{http_code} %{url_effective}\n" http://localhost:2567/playground
# 200 http://localhost:2567/playground/
```

`pnpm lint`, `pnpm build`, `pnpm --filter @dropfall/shared test` 전부 재확인 통과.

## 4. 사용 방법 (팀원 아무나)

```bash
pnpm --filter @dropfall/server run dev
```
브라우저로 **http://localhost:2567/playground/** 접속 → "game" 룸이 목록에 보임 → 클릭해서
접속하면 실시간으로 상태(state)가 표시되고, 메시지도 직접 보내볼 수 있다. 게임 클라이언트가
없어도 서버 동작을 눈으로 확인할 수 있는 가장 빠른 방법.

## 5. 다음 작업
- `packages/client` 스캐폴딩이 시작되면 Playground는 디버그용으로만 남기고, 실제 게임 클라이언트
  연결 테스트로 넘어간다
- 배포(D8-9) 시 `NODE_ENV=production`이 실제로 설정되는지 반드시 확인 — 안 하면 Playground가
  운영 서버에 그대로 노출된다

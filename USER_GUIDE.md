# Hmm-code 사용자 가이드

VS Code 확장의 모든 UI 기능 walkthrough.

> 기능 자체의 의미 / 워크플로우는 자매 repo
> [hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) 의 문서 참조:
> - [Workflow](https://github.com/lbm1202/hmm-code-pi/blob/main/WORKFLOW.md)
> - [Permissions](https://github.com/lbm1202/hmm-code-pi/blob/main/PERMISSIONS.md)
> - [AGENTS.md](https://github.com/lbm1202/hmm-code-pi/blob/main/AGENTS-md.md)
>
> 이 문서는 그것들을 "VS Code 안에서 어떻게 쓰느냐" 만 다룸.

---

## 1. 채팅 화면 진입

### 사이드바
- 액티비티 바의 Hmm 아이콘 클릭
- 또는 `Cmd+Shift+P` → "Hmm-code: Open Chat in Sidebar"

### 편집기 패널 (새 탭)
- 편집기 타이틀바의 `H` 아이콘 (PNG 로고)
- 또는 `Cmd+Shift+P` → "Hmm-code: New Chat Panel"
- 여러 개 동시에 열 수 있음 — 각 탭은 독립된 Pi 프로세스

### 패널 영속성
VS Code 윈도우 reload / 재시작 → 모든 탭 자동 복원. 마지막 열고 있던
세션 파일도 자동 재진입 (webview 의 persisted state).

---

## 2. 채팅 푸터 (picker row)

왼쪽부터: **mode picker** · **model picker** · **thinking picker** · **↺ 기본값** (조건부) · **🔒 Auto** 토글 · 우측 끝: **ctx 사용률** · **↑ 전송 / ■ 중단**

| 버튼 | 동작 |
|---|---|
| **mode picker** | 클릭 → 4모드 picker. 모드별 색상 (code=흰, plan=파랑, debug=보라, ask=주황) |
| **model picker** | 클릭 → 사용 가능한 모델 목록. alias 가 있으면 alias 표시 + raw id 는 sublabel |
| **thinking picker** | 클릭 → 모델 지원 thinking 레벨 |
| **↺ 기본값** | 현재 모델/thinking 이 모드 기본과 다를 때만 표시. 클릭 → 모드 default 복원 |
| **🔒 Auto / 🔓 Auto** | 권한 ask 자동승인 토글 ([§5](#5-auto-approve)) |
| **ctx XX%** | 컨텍스트 사용률 |
| **↑ / ■** | 전송 / 중단 |

---

## 3. 키보드 단축키

| 단축키 | 동작 |
|---|---|
| `Enter` | 메시지 전송 |
| `Shift+Enter` | 줄바꿈 |
| `Tab` / `Shift+Tab` | 모드 순환 (focus 가 prompt 안에 있을 때) |
| `Cmd/Ctrl + 클릭` (도구 호출의 파일 경로 위) | 그 파일을 편집기로 열기 |

전역 단축키 (커맨드 팔레트 등):
- `Hmm-code: Cycle Mode` — `Shift+Tab`
- `Hmm-code: Toggle Thinking` — `/mode-set` 단축
- `Hmm-code: Reset to Defaults` — `/reset`
- `Hmm-code: Abort` — 진행 중인 응답 중단

---

## 4. 도구 호출 렌더링

### 일반 도구 (read / grep / find / ls / bash)
- 한 줄 요약: `bash` 면 첫 줄 명령 + `(+N lines)` 힌트, `read` 면 path + `[start-end]`
- 결과 10 줄 초과면 자동 collapse (`N lines` 힌트)
- 실패는 빨강 `✗`, 성공은 자동 표시 없음 (raw 출력 그대로)

### edit / write / multi_edit (diff view)
- **Path 헤더 클릭 가능** — Ctrl/Cmd + 클릭 → 편집기로 열기
- 라인별 unified diff (LCS 기반):
  - 삭제: 빨강 배경 + `-` prefix
  - 추가: 초록 배경 + `+` prefix
  - 변경 없는 라인: 회색 (context)
- 단일 라인 edit 은 inline word-diff (변경된 부분만 하이라이트)
- 모든 다이프는 [**Shiki syntax highlighting**](https://shiki.style/) —
  Dark+ 테마, 25개 언어 지원 (ts/tsx/js/py/css/html/json/md/sh/go/rust/
  java/c/cpp/yaml/toml/sql/vue/svelte/xml/diff/ini/scss/jsx/jsonc 등)
- 미지원 확장자나 Shiki 로딩 전엔 plain text fallback

### read 결과
- 파일 path 추정 → Shiki 로 syntax highlight
- 전체 블록 토큰화 (multi-line 주석/string 컨텍스트 유지)

### 인터랙티브 도구 (ask_user / todo_write / finalize_plan / request_mode_switch)
- 카드형 UI — 질문 + 선택지, todo 체크리스트, accept/decline 등
- 토큰 절약 위해 raw JSON 안 보여줌

---

## 5. Auto-approve

채팅 푸터의 **🔒 Auto** 버튼.

- **꺼짐 (회색 자물쇠)**: 권한 시스템이 `ask` 를 판정하면 confirm
  다이얼로그 뜸
- **켜짐 (주황 🔓)**: 모든 `ask` 자동 통과. `deny` 는 여전히 차단

세션 한정 — 새 세션 시작 시 자동 OFF. 영구화 X (의도적).

**응답 도중 토글해도 즉시 적용** — 다음 도구 호출부터 새 상태 봄.
이미 떠 있는 confirm 은 사용자가 직접 처리 (다이얼로그가 갑자기
사라지면 더 혼란).

토글 시 채팅에 슬래시가 안 보임 — 인라인 RPC 채널로 처리.

---

## 6. 권한 confirm 다이얼로그

권한 시스템이 `ask` 판정하면 webview modal 뜸:

> **Permission**
>
> Mode "code" → bash command needs approval: `rm -rf node_modules`
>
> Allow this action?
>
> **[거절]** &nbsp;&nbsp; **[허용]**

- **허용**: 그 한 번만 통과. 같은 명령 다시 호출되면 또 ask
- **거절**: tool result 가 `isError: true` + "User denied" 로 LLM 에
  전달 → LLM 이 알아서 다른 접근 시도

여러 번 통과시키고 싶으면 Auto 버튼 켜기, 또는 `permissions.json` 에
직접 `"allow"` 룰 추가.

---

## 7. 세션 picker (🕘)

상단 🕘 버튼 클릭 → 세션 트리 모달.

- **부모-자식 트리**: `finalize_plan` 의 새 세션 분기로 만든 세션은
  parent 와 연결되어 트리로 묶임
- **`▶ / ▼`**: 자식 expand/collapse
- **클릭 (이동)**: 그 세션으로 전환
- **✏️**: 세션 이름 변경 (sidecar `.pi-modes-names.json` 에 저장, Pi
  session 파일은 immutable)
- **🗑**: 삭제. 자식이 있으면 cascade 경고.
  - **활성 세션 삭제 시 자동으로 새 세션 시작** — 죽은 세션 표시 방지

---

## 8. 설정 패널

푸터의 ⚙ 버튼 또는 `Cmd+Shift+P` → "Hmm-code: Open Settings". 자세히는
[SETTINGS.md](SETTINGS.md).

요약:
- **모드**: 각 모드의 model / thinking 편집
- **기타 모델 설정**: 자동 제목 생성 모델 (백그라운드 작업용)
- **공급자별 모델 필터**: picker 에 보일 모델 화이트리스트
- **공급자 인증**: API key / Codex OAuth 로그인
- **커스텀 공급자**: vLLM/Ollama 같은 자체 호스팅 endpoint 등록

저장 시 자동 reload — 모든 채팅 탭이 새 설정 적용.

---

## 9. 빈 상태 (최근 세션)

새 탭 / 세션 없음 → 가운데 Hmm 로고 + "최근 세션" 목록 (최근 5개).
클릭하면 그 세션으로 진입.

---

## 10. 색상 코드

| 모드 | 색 |
|---|---|
| code | 흰색 |
| plan | 파랑 |
| debug | 보라 |
| ask | 주황 |

mode picker chip + plan handoff 알림 + 푸터 mode label 에 일관 적용.

---

## 11. 트러블슈팅

### 채팅이 응답 안 함
- 사이드바 우상단 ↺ 버튼 보이면 클릭 — `restartChat` 트리거 (Pi 프로세스
  재시작)
- 또는 `Cmd+Shift+P` → "Developer: Reload Window"

### Pi 가 새 코드 안 봄
- Pi 프로세스는 startup 시점에만 확장 코드 로드
- 채팅 탭에서 `/reload-runtime` 슬래시 (해당 탭만 reload)
- 또는 설정 패널에서 저장 한 번 → `reloadAll` 자동 발화

### 권한 ask 가 무한 deny 되는 듯
- 헤드리스 모드 (UI 없는 RPC) 에선 ask 자동 deny — Pi 가 RPC 모드에서
  `ctx.hasUI` false 인 경우. 정상 동작
- 일반 채팅에선 confirm 다이얼로그가 떠야 정상. 안 뜨면 modal-root 가
  뭔가 가려져 있거나 webview console 에러 가능 — VS Code 의 "Developer:
  Open Webview Developer Tools" 로 확인

### Codex 로그인 후 모델이 안 뜸
- 로그인 성공 시 자동으로 모든 채팅 탭 재시작 (`restartAll`)
- 그래도 안 뜨면 윈도우 reload

### Settings 패널의 모델 dropdown 이 비어있음
- 채팅 한 번도 안 열린 상태라 model cache 가 비어있을 수 있음
- 채팅 탭 한 번 열어서 모델 fetch 가 일어나면 자동으로 settings 패널이
  refresh (cache observer 패턴)
- 또는 settings 패널이 처음 열릴 때 first live backend 에 자동 요청을
  보냄 → 잠시 후 dropdown 채워짐

### Edit/write diff 가 plain text 로만 보임
- Shiki 로딩 전 (extension 초기화 직후 1~2초) 거나 미지원 확장자
- 지원 언어 목록은 [README.md](README.md#features) 참조
- 안전한 fallback — diff structure 는 그대로 보임

---

## 12. 환경 정보

- VS Code 1.85+
- Pi `@earendil-works/pi-coding-agent` 4.x 이상 (글로벌 npm 또는
  homebrew 로 설치된 `pi` CLI 가 PATH 에 있어야 함)
- Pi 확장 [hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) 가
  `~/.pi/agent/extensions/modes/` 에 설치되어 있어야 함

# Hmm-code (VS Code Extension)

VS Code UI for the [Pi coding agent](https://github.com/badlogic/pi-mono).
`pi --mode rpc` 를 Claude-Code 스타일 native 채팅 surface 로 감싸고, 자매
extension [hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) (위치:
`~/.pi/agent/extensions/modes`) 와 짝지어 plan/code/debug/ask 워크플로우
+ 권한 시스템 + AGENTS.md + auto-approve 등 제공.

---

## 한눈에

| 기능 | 요약 |
|---|---|
| **사이드바 + 편집기 패널** | 사이드바 1개 + 편집기 탭 N개. 각자 독립 Pi 프로세스 |
| **윈도우 reload 영속성** | `WebviewPanelSerializer` + persisted lastSessionFile → reload 후 마지막 세션 자동 진입 |
| **모드 picker** | code(흰)/plan(파랑)/debug(보라)/ask(주황) — Pi 의 setStatus 미러 |
| **모델 picker + alias** | modes.json:modelAliases 자동 부착, 모델 필터 적용 |
| **인터랙티브 도구 카드** | ask_user / todo_write / finalize_plan / request_mode_switch 전용 UI |
| **edit/write diff** | LCS 기반 unified diff + [Shiki](https://shiki.style/) 25개 언어 syntax highlight |
| **read 결과 highlight** | 파일 경로 추정 → Shiki 전체 블록 토큰화 |
| **Ctrl/Cmd-click on file path** | 도구 호출의 파일 경로 → 편집기로 열기 |
| **Auto-approve 토글** | 권한 ask 자동 통과 (인라인 버튼, 세션 한정) |
| **권한 confirm modal** | Pi 의 `ctx.ui.confirm` → webview modal — Pi 의 permission 시스템 ([PERMISSIONS.md](https://github.com/lbm1202/hmm-code-pi/blob/main/PERMISSIONS.md)) UI surface |
| **설정 패널** | 모드/모델/필터/인증/커스텀 공급자 — 별도 편집기 탭 |
| **세션 picker** | 부모-자식 트리 + 이름변경 + cascade 삭제. 활성 세션 삭제 시 자동 새 세션 |
| **자동 제목** | 첫 메시지 페어 후 GPT-mini 로 세션 제목 생성 (Pi 확장) |

---

## 문서

| 문서 | 내용 |
|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) | 모든 UI 기능 walkthrough |
| [SETTINGS.md](SETTINGS.md) | 설정 패널 상세 |
| [ANALYSIS.md](ANALYSIS.md) | 파일별 deep-dive + 아키텍처 결정 |

Pi 확장 쪽 워크플로우 / 권한 / AGENTS.md 문서:
- [hmm-code-pi WORKFLOW](https://github.com/lbm1202/hmm-code-pi/blob/main/WORKFLOW.md)
- [hmm-code-pi PERMISSIONS](https://github.com/lbm1202/hmm-code-pi/blob/main/PERMISSIONS.md)
- [hmm-code-pi AGENTS-md](https://github.com/lbm1202/hmm-code-pi/blob/main/AGENTS-md.md)

---

## Architecture

```
VS Code Extension Host (Node)
  ├── spawn `pi --mode rpc`  (child process, stdio JSONL)
  ├── PiClient: framing + EventEmitter
  ├── ChatViewProvider: sidebar webview
  ├── ChatPanel: editor-area webview (with serializer for reload persistence)
  ├── SettingsPanel: standalone editor tab — modes/models/auth/permissions
  └── ChatBackend: PiClient ↔ webview bridge
        ├── cache observer pattern → SettingsPanel auto-refresh on model fetch
        ├── restartAll() → auth 변경 시 모든 Pi 재시작
        └── reloadAll() → modes/models 변경 시 broadcast /reload-runtime

Webview (HTML/CSS/TS, 14+ modules)
  ├── dispatch:        host → webview message router + Pi event handler
  ├── turn-lifecycle:  status row / bubble / rAF-debounced markdown stream
  ├── tools:           tool-call rendering (interactive + built-in pretty + LCS diff)
  ├── syntax:          Shiki lazy init + highlightLine + highlightBlock
  ├── pickers:         mode/model/thinking dropdowns
  ├── modals:          question cards + confirm/input dialogs (permission ask 포함)
  ├── session-picker:  parent-child tree with rename/delete
  ├── history:         past-message replay (alias-aware)
  ├── prompt:          send/abort + key handlers
  └── helpers/dom/state/protocol/types

Pi process
  └── loads ~/.pi/agent/extensions/modes/   ← hmm-code-pi
        ├── 4-mode system
        ├── finalize_plan / request_mode_switch / ask_user / todo_write
        ├── permissions/* (Layer 2 — tool_call hook)
        └── AGENTS.md auto-injection (before_agent_start)
```

TUI-specific bits (`setFooter`, `setHeader`, `setEditorComponent`,
`ctx.ui.custom`) 는 RPC 모드에서 no-op. 이 확장이 그에 해당하는 native
VS Code UI 를 제공.

---

## Features (상세)

### Chat
- 사이드바 + 편집기 패널 (다중)
- 실시간 streaming + **rAF-debounced markdown render** (animation frame
  당 최대 1번 `marked.parse`, multi-thousand-token 응답도 부드러움)
- Markdown HTML 의 `white-space: pre-wrap` 우회 — 리스트 들여쓰기가
  세로 빈 줄로 안 보임

### Interactive controls
- Mode / model / thinking dropdown — Pi 의 `setStatus` 미러
- Mode chip 모드별 색상
- Reset-to-defaults pill — 활성 model/thinking 이 모드 default 와
  다를 때만 노출 (Pi `overridden` status 미러)
- `↑` 전송 / `■` 중단 (turn in flight 시)
- Tab / Shift+Tab — prompt 안에서 모드 순환

### Tool rendering
- **인터랙티브 도구** (`ask_user`, `request_mode_switch`, `todo_write`,
  `finalize_plan`) — 카드형 결과 (QA 리스트, 체크리스트, accept/decline,
  3분기 다이얼로그)
- **`edit` / `write` / `multi_edit`** —
  - LCS 기반 unified diff (변경 없는 컨텍스트 라인은 회색)
  - 단일 라인 edit 은 inline word-diff
  - Shiki syntax highlighting (Dark+ 테마, 25개 언어)
  - 파일 path Ctrl/Cmd-click → 편집기 열기
- **`read`** — Shiki 전체 블록 토큰화
- **`bash` / `grep` / `find` / `ls`** — 한 줄 요약 + auto-collapse
- 성공/실패 마커: `✓ <message>` (초록) / `✗ <error>` (빨강)

### Sessions
- 세션 트리 picker — 부모-자식 hierarchy, expand/collapse, rename
  (sidecar `.pi-modes-names.json`), cascade 삭제 + descendant 경고
- "이동" 버튼으로 전환, 클릭은 expand 만
- **활성 세션 삭제 시 자동 새 세션** — Pi 가 죽은 파일 안 잡도록
  ChatBackend 에서 new_session 먼저 호출 후 파일 삭제
- 빈 상태에 "최근 세션" 5개 표시 (Hmm 로고 + 가운데 정렬)
- 자동 제목 (Pi 확장의 `auto-title.ts`)
- **윈도우 reload 패널 영속성** — `WebviewPanelSerializer` + persisted
  `lastSessionFile` 로 자동 `switch_session`

### Settings panel
- 별도 편집기 탭 (`Cmd+Shift+P` → "Hmm-code: Open Settings" 또는 ⚙ 버튼)
- 모드별 model/thinking 편집 — alias-aware dropdown
- 자동 제목 모델 override
- **공급자별 모델 필터** — picker 에 보일 모델 화이트리스트
- 공급자 인증 (API key 인라인 + Codex OAuth)
- 커스텀 공급자 (vLLM/Ollama 등) + 모델 자동 발견
- 저장 시 자동 reload (auth → restartAll, modes/models → reloadAll)
- 자세히: [SETTINGS.md](SETTINGS.md)

### Permission system integration
- Pi 의 `tool_call` 훅이 `ctx.ui.confirm` 호출 → webview modal 띄움
- **Auto-approve 버튼** (인라인) — `🔒 Auto` 켜면 모든 ask 자동 통과
  - SLASH 채널로 슬래시 보내서 user-bubble echo 없음
  - 응답 도중에도 즉시 적용 (Pi 의 slash command 는 streaming 중에도
    queue 없이 실행됨)
  - 세션 한정 (새 세션마다 OFF)
- Pi 의 권한 룰 자체는 [hmm-code-pi PERMISSIONS](https://github.com/lbm1202/hmm-code-pi/blob/main/PERMISSIONS.md)
  참조

### Branding
- "Hmm" 로고 (초록 LED 스타일): inline SVG (빈 상태), PNG (marketplace +
  편집기 타이틀)
- 활동 바 아이콘: monochrome SVG (`currentColor` 로 테마 적응)

---

## Commands & keybindings

| Command | Default key |
|---|---|
| `Hmm-code: Open Chat in Sidebar` | — |
| `Hmm-code: New Chat Panel` | (편집기 타이틀 `H` 버튼) |
| `Hmm-code: Open Settings` | (⚙ 버튼) |
| `Hmm-code: Cycle Mode` | `Shift+Tab` |
| `Hmm-code: Toggle Thinking Level` | `Alt+T` |
| `Hmm-code: Reset Model + Thinking` | `Alt+X` |
| `Hmm-code: Cancel Current Turn` | — |
| `Hmm-code: Restart Chat` | — (auth 변경 후 자동 트리거) |

---

## Develop

```bash
npm install
npm run build       # one-shot (minify on)
npm run watch       # incremental (no minify, for sourcemap dev)
```

VS Code 에서 `F5` → Extension Development Host. **Hmm-code** 활동 바
아이콘 클릭 또는 명령 팔레트 → **Hmm-code: Open Chat in Sidebar**.

---

## Install (locally)

```bash
npm install
npm run build
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension hmm-code-0.1.0.vsix --force
```

After install: `Cmd+Shift+P` → `Developer: Reload Window`.

---

## Layout

```
src/
  extension.ts        activate(), command registry, WebviewPanelSerializer
  chat-view.ts        sidebar WebviewViewProvider
  chat-panel.ts       editor-area WebviewPanel factory + adopt
  chat-backend.ts     PiClient ↔ webview bridge
                       - static cache + observer (settings panel sync)
                       - restartAll / reloadAll / requestModelsOnce
                       - DELETE_SESSION 핸들러 (활성 세션이면 new_session 먼저)
                       - SLASH 채널 (user-bubble echo 없는 슬래시 forward)
                       - OPEN_FILE 핸들러 (Ctrl/Cmd-click)
  pi-client.ts        spawn pi --mode rpc, JSONL framing, response correlation
  rpc-types.ts        Pi RPC protocol types
  protocol.ts         Shared constants (kinds, status keys, session-reset cmds)
  session-manager.ts  list/delete/rename sessions on disk
  settings-panel.ts   별도 편집기 탭의 설정 UI (~1500줄)
  oauth-codex.ts      Standalone PKCE + 127.0.0.1:1455 callback (Codex 로그인)
  info.ts             extract version + publisher from package.json

webview/
  main.ts             Bootstrap + 전역 click capture (Ctrl/Cmd file-link)
                       + Auto 버튼 click handler + mod-down body class
  dom.ts              APP_HTML, els refs, appendBubble/User/System, logo SVG
                       (Auto 버튼 + 빈 상태 중앙정렬 포함)
  state.ts            ui mirror (autoApprove 포함), runtime flags, persistedSessionFile
  protocol.ts         Mirror of src/protocol.ts (SLASH + OPEN_FILE + AUTO_APPROVE 포함)
  types.ts            ToWebview/FromWebview/SessionEntry/ModelEntry (alias 필드)
  helpers.ts          md, escapeHtml, cssEscape, safeStringify, summarizeArgs
  dispatch.ts         window.message 라우터 + Pi event 핸들러
                       (setStatus("auto-approve") → 버튼 색 갱신)
  turn-lifecycle.ts   Status row / bubble / rAF-debounced markdown
  tools.ts            Tool-call 렌더링 + edit/write/read 의 Shiki diff
                       (file-link span, LCS, lcsDiffOps)
  syntax.ts           Shiki lazy init (25 langs + dark-plus) + highlightLine/Block
  pickers.ts          showPopover + wirePickers (alias-aware)
  modals.ts           question cards + confirm/input dialogs
  session-picker.ts   세션 트리 modal
  history.ts          renderHistory / renderRecentList / clearConversation
  prompt.ts           doSend / updateSendButton / updatePromptDisabled

media/
  icon.svg            Activity bar (monochrome, currentColor)
  icon.png            Marketplace (128×128, 초록 H)
  icon-32.png         편집기 타이틀 (32×32, 초록 H)
  tab-icon.svg        WebviewPanel 탭 아이콘
  logo.svg            (예비 — 빈 상태는 dom.ts 의 inline SVG)
```

자세히는 [`ANALYSIS.md`](ANALYSIS.md).

---

## Companion repo

[hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) — RPC 로 대화하는
Pi 쪽 확장. 양쪽 다 설치해야 풀 동작.

---

## License

Personal use.

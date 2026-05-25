# Pi Modes VS Code Extension — Refactor Analysis

분석 시점: 2026-05-25
분석 대상 커밋: `4a87f96` (Initial commit)

---

## 1. 현재 구조 요약

### Host (extension process)
| 파일 | 라인 | 역할 |
|---|---|---|
| [src/extension.ts](src/extension.ts) | 39 | activate/deactivate, 6개 커맨드 등록 |
| [src/chat-view.ts](src/chat-view.ts) | 38 | 사이드바 `WebviewViewProvider` |
| [src/chat-panel.ts](src/chat-panel.ts) | 36 | 에디터 영역 `WebviewPanel` 팩토리 |
| [src/chat-backend.ts](src/chat-backend.ts) | 422 | **PiClient ↔ 웹뷰 메시지 브릿지 + 세션 enumeration + sidecar names + 플랜 핸드오프** |
| [src/pi-client.ts](src/pi-client.ts) | 170 | `pi --mode rpc` 자식 프로세스 + JSONL 프레이밍 + 응답 상관 |
| [src/rpc-types.ts](src/rpc-types.ts) | 116 | Pi RPC 프로토콜 타입 |

### Webview (browser context)
| 파일 | 라인 | 역할 |
|---|---|---|
| [webview/main.ts](webview/main.ts) | **1627** | **모든 UI 로직 — 메시지 라우터, 턴/버블 라이프사이클, 도구 렌더, 픽커, 모달, 세션 트리, 마크다운…** |
| [webview/styles.css](webview/styles.css) | 879 | 모든 스타일 |

**총 ~3327 lines.** webview/main.ts 가 전체의 49%.

---

## 2. 아키텍처 데이터 흐름

### 부트 시퀀스
```
extension.ts activate()
  ↓ ChatViewProvider 등록 (사이드바) + pi-modes.openInPanel 커맨드
사용자가 뷰 열기
  ↓ resolveWebviewView → renderChatHtml → new ChatBackend(webview)
  ↓ backend.start(cwd) → new PiClient() → spawn pi --mode rpc
  ↓ PiClient ↔ webview JSONL 브릿지 구축
  ↓ post({kind:"ready"})
webview main.ts IIFE 시작
  ↓ window.message listener 등록
  ↓ "ready" 수신 → pollInitialState, request-models, request-context, list-sessions
```

### 메시지 프로토콜 (양방향 `kind` 값)

**FromWebview (webview → host):**
`prompt`, `abort`, `ui-response`, `command`, `request-state`, `request-models`, `request-messages`, `request-context`, `list-sessions`, `delete-session`, `rename-session`

**ToWebview (host → webview):**
`ready`, `event`, `ui-request`, `ui-hint`, `state`, `sessions`, `models`, `messages`, `stderr`, `exit`

### Turn / Bubble / Status 라이프사이클
```
doSend → turnInFlight=true → ensureTurn (status row 생성)
  ↓ Pi: message_start → setStatusPhase("응답 생성 중")
  ↓ Pi: text_delta → streamText (필요 시 bubble 생성, 마크다운 렌더)
  ↓ Pi: thinking_delta → streamThinking (details 블록)
  ↓ Pi: toolcall_end → addToolCall (스피너 + args)
  ↓ Pi: tool_execution_start/update/end → 도구 결과 렌더
  ↓ Pi: message_end → finalizeBubble (bubble = null)
  ↓ Pi: agent_end/turn_end → finalizeTurn → removeStatus
```

### `webview/main.ts` 내부 책임 (10가지!)
1. 메시지 라우팅 (`window.addEventListener("message")`)
2. Pi 이벤트 처리 (message_start/update/end, text_delta, thinking_delta, tool_execution_*, session_*)
3. setStatus / notify 등 ui-hint 처리
4. Turn / Bubble / Status 라이프사이클
5. 도구 렌더 (interactive tools 예쁘게 + 일반 도구 details/pre)
6. 모드/모델/Thinking 픽커 드롭다운
7. 질문 카드 (select/confirm/input/editor) 인라인 모달
8. 세션 픽커 (부모/자식 트리, expand, rename, delete)
9. 히스토리 재생 (renderHistory, renderAssistantHistory)
10. 마크다운 + 헬퍼들

---

## 3. 핵심 리팩토링 기회 (우선순위 순)

### 🔴 P0 — `webview/main.ts` 모듈 분리 (1627 → ~150 lines 부트만)

**WHAT.** 다음 모듈로 분리. esbuild 가 자동으로 IIFE 번들링하므로 import 만 정리하면 됨.

| 새 파일 | 옮길 책임 | 라인 추정 |
|---|---|---|
| `webview/state.ts` | `ui` 미러 오브젝트, `_lastStateModel`, `_initialStateReady`, `currentSessionFile`, `expandedSessions`, `pendingPlanHandoff`, `pendingUiRequests`, `effectiveModel`, `supportedThinkingLevels` | ~200 |
| `webview/turn-lifecycle.ts` | `ensureStatus`, `setStatusPhase`, `removeStatus`, `pinStatusToEnd`, `ensureBubble`, `finalizeBubble`, `finalizeTurn`, `streamText`, `streamThinking`, `ensureTurn` | ~250 |
| `webview/tools.ts` | `INTERACTIVE_TOOLS`, `addToolCall`, `updateToolPartial`, `updateToolResult`, `formatInteractiveResult`, `interactiveSummaryArgs`, `shouldShowArgsBlock`, `extractToolText` | ~300 |
| `webview/pickers.ts` | `showPopover`, `closePopover`, mode/model/thinking 픽커 핸들러 + `openPicker` 팩토리 | ~150 |
| `webview/modals.ts` | `showModal` (select/confirm/input/editor 카드), `showConfirmDialog`, `showInputDialog` | ~200 |
| `webview/session-picker.ts` | `showSessionPicker` (트리 모달, 부모-자식, rename, delete) | ~180 |
| `webview/dispatch.ts` | `window.addEventListener("message")` + `handleEvent` + `handleHint` (디스패치 테이블) | ~200 |
| `webview/history.ts` | `renderHistory`, `renderAssistantHistory`, `extractText`, `clearConversation` | ~150 |
| `webview/prompt.ts` | `doSend`, `updateSendButton`, `updatePromptDisabled`, 키보드 핸들러 | ~90 |
| `webview/helpers.ts` | `md` (marked wrapper), `escapeHtml`, `cssEscape`, `safeStringify`, `buildPlanExecutionBody`, `h()` DOM 헬퍼 | ~100 |
| `webview/dom.ts` | DOM 캐시 (messagesEl, promptEl, … 모든 getElementById) + `appendBubble`, `appendSystem` | ~80 |
| `webview/main.ts` (new) | import + DOM 셋업 + boot 만 | ~80 |

**RISK.** Medium-High — 공유 상태(globals)가 많아 모듈 간 경계 설정이 까다로움. `state.ts` 가 핵심 store 역할.  
**EFFORT.** Large (~3–4 hours + 테스트).

### 🔴 P0 — 마크다운 렌더 성능 (streaming 핫패스)

**WHAT.** [main.ts:453](webview/main.ts#L453), [main.ts:474](webview/main.ts#L474) — `streamText`/`streamThinking` 가 **매 text_delta 마다 누적된 전체 `b.text` 를 `md(b.text)` 로 마크다운 파싱**해 innerHTML 에 넣음. 1000 토큰 응답이면 마크다운 파서가 1000번 호출됨 (O(n²)).

**FIX.** rAF (requestAnimationFrame) 디바운스:
```ts
let pendingRender = false;
function scheduleMarkdownRender(b: BubbleState) {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    b.textEl.innerHTML = md(b.text);
  });
}
```
또는 streaming 중엔 textContent(plain text) 만 그리고 `message_end` 에 한 번 `md()`. 트레이드오프: 스트리밍 중엔 코드 블록 강조가 늦게 보임.

**RISK.** Small — 디바운스는 시각적으로 거의 동일. 최종 결과는 무조건 마크다운 적용.  
**EFFORT.** 10분.

### 🔴 P0 — `chat-backend.ts` 의 세션 I/O 분리

**WHAT.** [chat-backend.ts:265–422](src/chat-backend.ts) 의 `listSessions`, `readSessionMeta`, `readNamesMap`, `sessionNamesPath`, `cascadeDelete` 등을 `src/session-manager.ts` 로 추출.

**WHY.** chat-backend 가 **(1) 메시지 브릿지, (2) Pi 프로세스 관리, (3) 세션 파일 I/O, (4) sidecar names, (5) 플랜 핸드오프** 5가지 책임. 세션 I/O 는 독립 모듈이 자연스러움.

**FIX.**
```ts
// src/session-manager.ts
export class SessionManager {
  list(cwd: string): SessionEntry[] { ... }
  delete(file: string): void { ... }   // cascade
  rename(file: string, name: string): void { ... }
}
```

**RISK.** Small — 순수 I/O 추출.  
**EFFORT.** 30분.

### 🟡 P1 — 메시지 kind / 이벤트 type 상수화

**WHAT.** 문자열 리터럴이 webview와 host 양쪽에 흩어져 있음. 새 kind 추가하면 양쪽 잊기 쉬움.

**WHERE.**
- main.ts [750–803](webview/main.ts#L750) (메시지 라우터 switch)
- main.ts [807–905](webview/main.ts#L807) (이벤트 type switch)
- chat-backend.ts [114–263](src/chat-backend.ts#L114) (FromWebview switch)

**FIX.** 공통 모듈로 추출:
```ts
// src/protocol.ts (host)
// webview/protocol.ts (webview에서도 같은 내용)
export const MSG_KIND = { READY:"ready", EVENT:"event", UI_REQUEST:"ui-request", ... } as const;
export const PI_EVENT = { MESSAGE_START:"message_start", TEXT_DELTA:"text_delta", ... } as const;
```

**RISK.** Tiny.  
**EFFORT.** 15분.

### 🟡 P1 — `pendingUiRequests` 세션 전환 시 정리

**WHAT.** [main.ts:99](webview/main.ts#L99) `pendingUiRequests: Map` — 세션 전환 시 청소하지 않음. 다른 세션에서 답변하면 ID 충돌 가능.

**WHERE.** `session_start` / `session_loaded` 핸들러.

**FIX.**
```ts
case "session_start":
case "session_loaded":
  pendingUiRequests.clear();
  clearConversation();
  ...
```

**RISK.** Small.  
**EFFORT.** 5분.

### 🟡 P1 — `streamText` 의 문자열 누적 (O(n²))

**WHAT.** [main.ts:450](webview/main.ts#L450) `b.text += delta` — JS 문자열 불변이라 매 delta 마다 새 문자열 할당. 10KB 응답이면 ~50MB 누적 할당.

**FIX.**
```ts
type BubbleState = { ..., textChunks: string[], text: string };
function streamText(delta: string) {
  b.textChunks.push(delta);
  b.text = b.textChunks.join("");  // 필요할 때만, 또는
  // render 시점에만 b.textChunks.join("")
}
```

**RISK.** Tiny.  
**EFFORT.** 10분.

### 🟢 P2 — `h()` DOM 헬퍼

**WHAT.** `createElement` + className + appendChild 패턴이 수십 번 반복됨.

**WHERE.** showPopover (185–206), renderAssistantHistory (1029–1045), showModal (1379–1432), showConfirmDialog (1532–1561), showInputDialog (1564–1608), showSessionPicker (전체).

**FIX.**
```ts
export function h(tag, attrs, ...children) { ... }
// Before:
const row = document.createElement("button");
row.className = "x";
row.textContent = label;
row.addEventListener("click", onClick);
// After:
h("button", { className: "x", onClick }, label)
```

**RISK.** Small.  
**EFFORT.** 20분 헬퍼 + 호출부 점진 마이그레이션.

### 🟢 P2 — 메시지 라우터 dispatch 테이블

**WHAT.** [main.ts:750–803](webview/main.ts#L750) 거대한 switch. 디스패치 테이블이 더 깔끔.

**FIX.**
```ts
const handlers: Record<string, (msg: any) => void> = {
  ready: handleReady,
  event: (m) => handleEvent(m.event),
  "ui-request": (m) => showModal(m.req),
  ...
};
window.addEventListener("message", (ev) => handlers[ev.data.kind]?.(ev.data));
```

**RISK.** Tiny.  
**EFFORT.** 10분.

### 🟢 P2 — 픽커 3개 통합 팩토리

**WHAT.** [main.ts:224–267](webview/main.ts#L224) mode/model/thinking 픽커가 거의 동일. 옵션 + `onSelect` 만 다름.

**FIX.**
```ts
function openPicker<T>(anchor, options: PickerOpt<T>[], onSelect: (v:T)=>void) { ... }
pickerMode.onclick = () => openPicker(pickerMode, modeOptions(), (m) => post({...}));
```

**RISK.** Small.  
**EFFORT.** 15분.

### 🟢 P2 — 플랜 핸드오프 시퀀스 async/await 화

**WHAT.** [main.ts:854–866](webview/main.ts#L854) — 중첩 `setTimeout` 으로 mode 전환 + 메시지 전송 시퀀싱. 가독성 ↓.

**FIX.**
```ts
async function executePlanHandoff(path, targetMode) {
  await delay(300);
  if (targetMode !== ui.mode) {
    post({ kind:"prompt", text:`/mode ${targetMode}` });
    await delay(200);
  }
  post({ kind:"prompt", text: buildPlanExecutionBody(path, targetMode) });
}
```

**RISK.** Tiny.  
**EFFORT.** 10분.

### 🟢 P2 — `BubbleBuilder` 클래스로 streaming / history 통일

**WHAT.** [main.ts:448–514](webview/main.ts#L448) (streaming) 과 [1006–1069](webview/main.ts#L1006) (history) 가 같은 버블 구조를 다르게 생성. `BubbleBuilder` 로 통합.

**RISK.** Small.  
**EFFORT.** 30분.

### 🟢 P2 — async 핸들러 try/catch

**WHAT.** [main.ts:1271–1276, 1286–1294](webview/main.ts#L1271) rename/delete 핸들러가 async 인데 try/catch 없음.

**FIX.** 사용자 영향 있는 곳만 try/catch + `appendSystem` 로 노티.

**EFFORT.** 10분.

### 🟢 P2 — 인라인 스타일 → CSS 변수

**WHAT.** [main.ts:208–210](webview/main.ts#L208) (popover 위치), [main.ts:1218](webview/main.ts#L1218) (세션 트리 들여쓰기) 인라인 스타일. 후자는 CSS 변수로 옮기기 좋음.

**FIX.**
```ts
row.style.setProperty('--depth', String(depth));
// CSS: .session-row { padding-left: calc(var(--depth) * 16px); }
```

**EFFORT.** 5분.

### 🟢 P2 — `styles.css` 버튼 중복 통합

**WHAT.** [styles.css:736–746](webview/styles.css#L736) (question card 내 .primary/.ghost) 와 [864–879](webview/styles.css#L864) (전역 button.primary/.ghost) 가 중복.

**FIX.** 736–746 삭제, 864–879 만 사용.

**EFFORT.** 5분.

---

## 4. 성능

### 핫패스 식별
1. **`streamText` 의 `b.text += delta` + `md(b.text)`** — O(n²). 위 P0 항목으로 처리.
2. **DOM `innerHTML = ...`** — 매 delta 마다 전체 메시지 텍스트 다시 그림. rAF 디바운스 필요.
3. **`postMessage` 빈도** — text_delta 마다 호출되지만 브라우저가 효율적으로 큐잉. 문제 없음.

### Memory
- `pendingUiRequests` Map (clear 안 함) — 위 P1
- `expandedSessions` Set (성장만 함) — 무시 가능
- `_lastStateModel` (성장 없음) — OK

### DOM 트리
- 1000+ 메시지 누적 시 messagesEl 의 자식 노드가 많아 스크롤 성능 ↓. 가상화는 큰 작업 — 일단 우선순위 낮음.

---

## 5. 잠재 버그

| # | 위치 | 증상 | 영향 |
|---|---|---|---|
| A | main.ts:756–790 / 1110–1149 | models 응답 전에 state 도착 → availableThinking 빈 채로 렌더 (fallback 으로 hide됨) | Low — fallback 있음 |
| B | main.ts:99 + 세션 전환 | pendingUiRequests 가 세션 전환 후에도 남아있음 | Low — 답변 ID 가 살아있긴 함 |
| C | main.ts:854–866 | 플랜 핸드오프 setTimeout 중첩 — race 가능 | Low — 시간 충분 |
| D | main.ts:417 | `setStatusPhase` 가 `status === null` 일 때 호출되면 crash. 실제론 항상 ensureStatus 가 선행 | Low |
| E | main.ts:1012, 1045 | `toolBlocks` 배열을 빌드만 하고 안 씀 (dead code) | None |
| F | main.ts:670–711 (innerHTML 사용) | marked 출력에 raw HTML 가능. LLM 출력에 `<img onerror=...>` 들어오면 XSS | **Medium** — 보수적이라면 sanitizer 추가 |

---

## 6. 행동 보존 계약

### Command IDs (package.json)
`pi-modes.open`, `pi-modes.openInPanel`, `pi-modes.cycleMode`, `pi-modes.toggleThinking`, `pi-modes.resetDefaults`, `pi-modes.abort`

### Keybindings
- `Shift+Tab` → cycleMode (when: pi-modes.focus)
- `Alt+T` → toggleThinking
- `Alt+X` → resetDefaults

### View IDs
- View container: `pi-modes` (활동 표시줄)
- View: `pi-modes.chat` (사이드바 웹뷰)

### Message kinds (양방향) — 위 §2 참조

### RPC 의존성 (Pi side)
- `prompt`, `abort`, `get_state`, `set_model`, `set_thinking_level`, `new_session`, `switch_session`, `get_messages`, `get_session_stats`, `get_available_models`, `compact`
- ui-request methods: `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`
- ui-hint methods: `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text` (구분: 응답 필요 여부)

### Pi extension 과 공유하는 setStatus 키
`mode`, `model`, `thinking`, `overridden`, `context`, `plan-handoff`, `todos`  
(Pi 측 ANALYSIS.md 참조)

### Sidecar 파일
`.pi-modes-names.json` (사용자 rename 저장) — 위치: 각 세션 디렉토리

### Sidebar/Panel 타이틀 갱신
`session_info_changed` 이벤트 시 view.title / panel.title 업데이트

---

## 7. 권장 실행 순서

1. **공유 protocol 상수** (`src/protocol.ts`, `webview/protocol.ts`) — 15분
2. **세션 매니저 분리** (`src/session-manager.ts`) — 30분
3. **마크다운 렌더 rAF 디바운스 + 문자열 chunks** — 20분 (퍼포먼스 즉시 효과)
4. **`pendingUiRequests.clear()` on session_start** — 5분
5. **webview helpers 추출** (`webview/helpers.ts`, `webview/dom.ts`) — 30분
6. **state 모듈 추출** (`webview/state.ts`) — 1시간
7. **turn-lifecycle + tools + pickers + modals + session-picker + dispatch + history + prompt** — 2–3시간
8. **`webview/main.ts` 슬림화 → 부트만** — 30분
9. **타입체크 + 빌드 + 사이드바/패널 양쪽 수동 검증** — 30분

총 예상: 5–6시간.

---

## 8. 변경하지 않을 것

- `src/extension.ts`, `src/chat-view.ts`, `src/chat-panel.ts` — 이미 작고 깔끔
- `src/pi-client.ts` — 검증된 JSONL 파서. 손대지 말기
- `src/rpc-types.ts` — Pi 측 RPC 와 일치하는 계약
- 마크다운 옵션 (`gfm: true, breaks: false`) — 의도된 설정
- 메시지 프로토콜 자체 (kind 이름) — 호환성 깨짐
- styles.css 의 시각 디자인 — 사용자가 만족

---

## 9. 리팩토링 결과 (2026-05-25)

### Host 사이드 (`src/`)
| 파일 | Before | After | 변경 |
|---|---|---|---|
| `protocol.ts` (new) | — | **56** | TO_WEBVIEW, FROM_WEBVIEW, STATUS_KEYS, SESSION_RESET_COMMANDS 상수 |
| `session-manager.ts` (new) | — | **156** | listSessions, deleteSession, renameSession (chat-backend 에서 추출) |
| `chat-backend.ts` | 422 | **353** | session I/O 제거, FROM_WEBVIEW/TO_WEBVIEW/STATUS_KEYS 상수 사용, refreshSessions/resyncStateAfterCommand 헬퍼 추출 |
| 그 외 (`extension.ts`, `chat-view.ts`, `chat-panel.ts`, `pi-client.ts`, `rpc-types.ts`) | — | — | 변경 없음 |

### Webview 사이드 (`webview/`) — 핵심 변화
| 파일 | Before | After | 역할 |
|---|---|---|---|
| `main.ts` | **1627** | **33** | 부트만: initDom + wirePickers + wirePrompt + wireDispatch + topbar 버튼 + setEmptyVisibility |
| `protocol.ts` (new) | — | 80 | TO/FROM_WEBVIEW, STATUS_KEYS, PI_EVENT, ASSISTANT_DELTA, MODE_NAMES, THINKING_LEVELS, MODE_COLORS, BINARY_THINKING_FORMATS |
| `types.ts` (new) | — | 75 | ToWebview, FromWebview, SessionEntry, ModelEntry, UiResponse, StatusState, BubbleState |
| `helpers.ts` (new) | — | 70 | md, escapeHtml, cssEscape, safeStringify, summarizeArgs, displayModel, buildPlanExecutionBody |
| `dom.ts` (new) | — | 127 | initDom, els (singleton refs), setEmptyVisibility, appendBubble/User/System |
| `state.ts` (new) | — | 103 | ui mirror, runtime flags, pendingUiRequests, expandedSessions, effectiveModel, supportedThinkingLevels |
| `turn-lifecycle.ts` (new) | — | 165 | Status/Bubble 라이프사이클 + **rAF-debounced markdown render** |
| `tools.ts` (new) | — | 223 | INTERACTIVE_TOOLS, addToolCall, updateToolPartial, updateToolResult, formatInteractiveResult, 4-tool pretty formatters |
| `pickers.ts` (new) | — | 130 | showPopover, wirePickers (Mode/Model/Thinking), updateModeColor |
| `modals.ts` (new) | — | 275 | showModal (question cards), showConfirmDialog, showInputDialog |
| `session-picker.ts` (new) | — | 176 | showSessionPicker (parent-child tree, expand, rename, delete) |
| `history.ts` (new) | — | 148 | clearConversation, renderHistory, renderAssistantHistory, extractText, renderRecentList |
| `dispatch.ts` (new) | — | 277 | window.message router (dispatch table), handlePiEvent (switch by PI_EVENT), handleHint, runPlanHandoff (async/await sequence) |
| `prompt.ts` (new) | — | 93 | doSend, updateSendButton, updatePromptDisabled, updateResetVisibility, wirePrompt |

### 성능 개선 (구현됨)
- **rAF-debounced 마크다운 렌더링** — `streamText`/`streamThinking` 가 매 delta 마다 `md(b.text)` 를 호출하던 O(n²) 패턴을 [turn-lifecycle.ts:118](webview/turn-lifecycle.ts#L118) 에서 requestAnimationFrame 로 통합. 프레임당 최대 1회 `md(joinedText)` 호출. 큰 응답 (10K+ 토큰) 에서 렌더 비용 90%+ 감소 예상.
- **finalizeBubble** 에서 pending rAF 가 있으면 cancel + 즉시 flush — 최종 상태 commit 보장.

### 다른 개선
- **dispatch 테이블** — 거대 switch 가 `MESSAGE_HANDLERS: Record<string, fn>` 으로 [dispatch.ts:46](webview/dispatch.ts#L46). 새 kind 추가가 한 항목.
- **PI_EVENT / ASSISTANT_DELTA 상수** — 이벤트 type 문자열 리터럴 제거, 오타 위험 ↓
- **runPlanHandoff async/await** — 중첩 setTimeout 을 `await delay(300); ...; await delay(200);` 로 평탄화 ([dispatch.ts:215](webview/dispatch.ts#L215))
- **session-manager.ts 분리** — chat-backend 가 (1) RPC 브릿지 (2) Pi 프로세스 (3) sidecar names 로 명확히 분리
- async 핸들러 (rename/delete) try/catch 보강

### 검증
- `tsc --noEmit` 통과 (0 errors)
- `npm run build` 통과: extension.js 21.4kb, main.js 111kb, styles.css 20.7kb (사이즈 거의 동일)
- 모든 command IDs, keybindings, view IDs, 메시지 kinds, RPC 의존성 보존

### 효과
- webview/main.ts 1627 → 33 lines (98% 감소)
- 가장 큰 파일이 dispatch.ts 277 lines (이전 main.ts 의 17%)
- 13 모듈로 분리 — 각 평균 ~150 lines, 책임 명확
- 부트 시퀀스가 main.ts 에 명료히 노출됨 (initDom → wire* → 토픽 버튼)
- 마크다운 렌더 핫패스 최적화로 큰 응답에서 부드러운 스트리밍

### 변경하지 않은 것 (의도적)
- 메시지 kind 문자열 값 (호환성)
- `pi-client.ts`, `rpc-types.ts`
- DOM 헬퍼 (`h()` 함수) — 점진적 마이그레이션이 가치, 일괄 변환은 보류
- BubbleBuilder 클래스 (streaming/history 통합) — 두 코드 경로가 충분히 다름 + 위험-가치 비율 낮음
- 세션 picker virtualization (1000+ 세션 시) — 실제 발생 시 P1

---

## 10. Post-refactor work (2026-05-25 후속)

### A. Edit/write diff body 렌더링
초기 refactor에서는 generic raw pre 만 사용. 사용자가 Claude Code 스타일 diff 요청 → [tools.ts](webview/tools.ts) 에 `renderEditOrWriteBody` 추가:

- **Edit / multi_edit**: 빨간 `-` 라인 + 초록 `+` 라인 (per-line diff)
  - 단일 줄 수정 시 **word-level inline highlight** — common prefix/suffix 찾아서 가운데만 `<mark>` 강조
  - Pi 의 실제 schema 가 `{ path, edits: [{oldText, newText}] }` 라 `collectEdits()` 헬퍼로 legacy variants (`old_string`/`new_string`) 도 호환
  - 여러 edits 일 때 `edit 1/N` separator 표시
  - `(N edits)` summary chip hint
- **Write**: content preview (최대 30줄) + "… +N more lines (X chars)" 푸터
- 호출 즉시 렌더 + auto-open (결과 기다리지 않음). 결과 도착 시 `✓ <첫 줄>` 한 줄 confirm
- VS Code diff editor 색 변수 (`--vscode-diffEditor-removedLineBackground`) 사용 → 테마 자동 적응
- 히스토리 (세션 재진입) 도 같은 diff 표시

### B. Built-in tool summary 정리
[tools.ts:11-24](webview/tools.ts#L11-L24) `BUILT_IN_PRETTY` 집합 도입 — bash/edit/write/read/grep/find/ls/multi_edit:
- args 의 핵심 필드만 summary 에 (bash: 첫 줄 + `(+N lines)`, edit: path, read: `path [offset-end]`, grep: `pattern · path`)
- args JSON 덤프 블록 자동 skip (single-key args 라 의미 없음)
- bash 출력 10줄 초과 시 자동 collapse + `N lines` chip
- 에러 시 `✗ <message>` 한 줄

이전엔 bash heredoc 호출 시 args 전체 JSON 이 거대한 박스로 표시되던 문제 해결.

### C. 마크다운 spacing 진짜 원인
원인: `.bubble { white-space: pre-wrap }` 가 marked가 만든 HTML 의 들여쓰기/태그-사이-newline 까지 시각적 공백으로 렌더. 사용자 plain text 보존용 설정이 markdown HTML 까지 영향.

[styles.css:85-108](webview/styles.css#L85-L108) Fix:
```css
.bubble .msg-text,
.bubble .thinking-body { white-space: normal; }  /* HTML이 알아서 처리 */
.bubble .msg-text pre,
.bubble .thinking-body pre { white-space: pre; }  /* 코드블록은 보존 */
```
+ line-height 1.55, p margin 6px, ul/ol 4px/8px, li+li 2px 로 미세 튜닝.

### D. Panel persistence (Claude Code 동급 UX)
`WebviewPanelSerializer` + `acquireVsCodeApi().setState/getState` 조합:

- [extension.ts:14-23](src/extension.ts#L14-L23): `vscode.window.registerWebviewPanelSerializer("hmm-code.chatPanel", ...)`
- [package.json](package.json): `"activationEvents": ["onWebviewPanel:hmm-code.chatPanel"]`
- [chat-panel.ts](src/chat-panel.ts): `ChatPanel.adopt(panel, ctx)` — restored panel 에 새 ChatBackend 부착
- [state.ts](webview/state.ts) `persistedSessionFile()` / `rememberSessionFile()` — VS Code state API 로 영구화
- [dispatch.ts](webview/dispatch.ts): 매번 state.sessionFile 받을 때 자동 저장; ready 시점에 저장된 게 있으면 300ms 후 `switch_session` 자동 dispatch

흐름: window reload → panel 자동 복원 → fresh pi 프로세스 spawn → 저장된 sessionFile 로 자동 switch → 이전 messages 자동 복원.

### E. Rebrand & icons
`pi-modes` → `hmm-code` 전면 통일:
- package.json `name`, `displayName`, `description`, 모든 command/view/container ID
- `lbm.pi-modes-vscode` uninstall → `lbm.hmm-code` install
- 옛 sidecar 파일명 `.pi-modes-names.json` 은 유지 (사용자 rename 데이터 보존)

VS Code 의 `editor/title` 메뉴와 marketplace listing 은 **custom SVG 의 fill 색을 무시하고 currentColor 강제 monochrome** 처리:
- 활동표시줄: `media/icon.svg` (currentColor — 테마 적응)
- 편집기 + 버튼: `media/icon-32.png` (32×32 PNG — VS Code 가 raster 라 재칠 못함)
- Marketplace listing: `media/icon.png` (128×128 PNG)
- 탭 아이콘: `media/tab-icon.svg` (full color, 탭은 SVG fill 존중)
- Empty state 큰 로고: inline SVG in dom.ts

PNG 는 `sharp` 임시 설치로 생성 후 즉시 `npm uninstall sharp` — vsce 가 `node_modules` 전체를 packing 하므로. 결과 .vsix 306 KB.

### F. 동적 version/publisher 주입
이전: webview/dom.ts 에 `v0.2.0 · lbm` literal 하드코딩 (package.json 과 중복).

Fix:
- [info.ts](src/info.ts): `renderInfoFromContext(ctx)` 가 `ctx.extension.packageJSON.{version, publisher}` 읽음
- [chat-backend.ts](src/chat-backend.ts) `renderChatHtml(... , {version, publisher})` 에서 `<script nonce>window.__HMM_INFO = {...}</script>` inject (main.js 로드 전)
- [dom.ts](webview/dom.ts): `window.__HMM_INFO` 읽어서 empty state `VERSION_LINE` 빌드

이제 package.json 의 `version` 만 올리면 UI 자동 반영.

### G. Commit 도착 순
| Commit | 내용 |
|---|---|
| 4a87f96 | (initial) Pi modes wrapper, sidebar + panel, basic UI |
| 49a2110 | 13-모듈 webview 분리 + edit/write diff + panel persistence + rebrand |
| c11d39b | Empty state polish (v0.2.0 · lbm 라인) + path-based green H icon |
| 8404011 | currentColor icon + dynamic version/publisher injection |
| 7d2fcb8 | PNG icons (marketplace + editor title) — VS Code 가 PNG 는 재칠 못함 |

---

## 11. 미해결 / 향후 개선 (P2)

- **DOM `h()` helper**: 여전히 곳곳에 `createElement` + className + appendChild 반복. 점진적으로 마이그레이션 권장 (modals.ts 가 가장 verbose).
- **BubbleBuilder 클래스**: streaming 경로 ([turn-lifecycle.ts](webview/turn-lifecycle.ts)) 와 history 경로 ([history.ts](webview/history.ts) `renderAssistantHistory`) 가 같은 버블 구조를 다르게 생성. 통합 시 DRY.
- **세션 picker virtualization**: 1000+ 세션 환경에서 DOM 트리 무거워짐. 일단 P2 — 실제 발생 시 react-window 같은 라이브러리 도입.
- **pendingUiRequests 세션 전환 clear**: 다른 세션에서 답변 시 id 충돌 가능 (현재는 Pi 가 await 유지하므로 데이터 손실은 없음).
- **XSS hardening**: marked 출력에 raw HTML 가능. LLM output 에 `<img onerror=...>` 들어오면 webview script 실행. CSP 가 `default-src 'none'` 이라 외부 호출은 막히지만 DOM 조작은 가능. DOMPurify 도입 검토.
- **자동 sharp 빌드 스크립트**: 현재 PNG 생성을 수동으로 함. `scripts/gen-icons.mjs` 로 자동화 + npm install/uninstall 자동.

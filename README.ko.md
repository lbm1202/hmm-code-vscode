<div align="center">

<img src="media/icon.png" alt="Hmm-code" width="128" />

# Hmm-code

**[Pi 코딩 에이전트](https://github.com/badlogic/pi-mono)를 위한 네이티브 VS Code UI.**
plan / code / debug / ask 모드 · 권한 레이어 · AGENTS.md 자동 주입 · 자체 완결형 `.vsix`

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue.svg)](https://code.visualstudio.com/)
[![Release](https://img.shields.io/github/v/release/lbm1202/hmm-code-vscode?label=release)](https://github.com/lbm1202/hmm-code-vscode/releases)
[![Pi-coding-agent](https://img.shields.io/badge/Pi-0.77.x-purple.svg)](https://github.com/badlogic/pi-mono)

[English](README.md) · **한국어**

[설치](#설치) · [기능](#기능) · [문서](#문서) · [Pi 확장](https://github.com/lbm1202/hmm-code-pi)

</div>

---

> 에디터를 떠나지 않고 VS Code 패널에서 Pi 코딩 에이전트 세션을 다룹니다 — 모드 인식 diff, 계획 우선 워크플로, 권한 프롬프트, 세션 히스토리.

---

## 설치

### 릴리즈에서 설치 (권장)

```bash
# GitHub Releases에서 최신 .vsix 받기
curl -L -o hmm-code.vsix \
  "$(curl -s https://api.github.com/repos/lbm1202/hmm-code-vscode/releases/latest \
     | grep browser_download_url | cut -d'"' -f4)"

# 설치
code --install-extension hmm-code.vsix
```

또는 <https://github.com/lbm1202/hmm-code-vscode/releases> 에서 받아 VS Code 확장 패널 → `…` 메뉴 → **Install from VSIX…** 로 설치하세요.

설치 후 Activity Bar의 Hmm-code 아이콘을 클릭하거나, 명령 팔레트에서 "Hmm-code: Open Chat in Sidebar" 를 실행합니다.

### 소스에서 빌드
두 저장소를 나란히 클론합니다 (빌드는 `hmm-code-pi`가 `hmm-code-vscode`의 형제 디렉터리에 있다고 가정):
```bash
git clone https://github.com/lbm1202/hmm-code-pi.git
git clone https://github.com/lbm1202/hmm-code-vscode.git
cd hmm-code-vscode
npm install
npm run build           # Pi 런타임 + hmm-code-pi를 out/vendor/ 로 번들
npx @vscode/vsce package
code --install-extension hmm-code-0.1.0.vsix --force
```

형제 디렉터리가 없으면 빌드가 `hmm-code-pi`를 `node_modules/.cache/` 로 자동 클론합니다. 다른 위치의 기존 클론을 쓰려면 `HMM_CODE_PI_PATH=/path/to/clone` 으로 지정하세요.

---

## 기능

| | |
|---|---|
| 📦 **자체 완결형 `.vsix`** | Pi 런타임 + hmm-code-pi 확장을 함께 동봉. 한 번 설치하면 별도의 Pi 설정 불필요. |
| 🪟 **사이드바 + 에디터 패널** | 사이드바 뷰 1개 + 에디터 탭 N개. 각 탭이 독립된 Pi 프로세스를 가짐. |
| 🔁 **재로드 복원** | `WebviewPanelSerializer` + `lastSessionFile` 저장 — VS Code 재로드 시 마지막 세션으로 복귀. |
| 🎨 **모드 피커** | `code`(흰색) · `plan`(파랑) · `debug`(보라) · `ask`(주황). Pi의 `setStatus`를 반영. |
| 🤖 **모델 피커 + 별칭** | `modes.json:modelAliases` 의 별칭. 모드별 필터. |
| 🃏 **인터랙티브 도구 카드** | `ask_user`, `todo_write`, `finalize_plan`, `request_mode_switch` 전용 UI. |
| 📝 **edit / write diff** | LCS 기반 통합 diff + [Shiki](https://shiki.style/) 문법 강조 (25개 이상 언어). |
| 🖱️ **파일 경로 Ctrl/Cmd-클릭** | 도구 호출의 파일 경로를 에디터에서 열기. |
| 🔓 **자동 승인 토글** | 권한 `ask` 프롬프트를 세션 단위로 우회 (인라인 버튼). |
| 🛡️ **권한 확인 모달** | Pi의 `ctx.ui.confirm`을 webview 모달로 — Pi 권한 시스템의 UI. |
| ⚙️ **설정 패널** | 탭형 에디터 (기본 / 인증 / 모델 / 모드 / 프롬프트) — 언어, 자동 승인 기본값, 다이나믹 압축 + 임계값, 요약 모델, 편집 가능한 프롬프트(모드 + 자동제목 + 요약 포커스), API 키, OAuth 로그인, 커스텀 공급자. |
| 🗜️ **다이나믹 압축** | 에이전트의 턴 도중에 끊지 않고 턴 경계에서 컨텍스트를 자동 요약 (토글 + 50–85% 임계값). 채팅 푸터에 수동 **Compact** 버튼. |
| 🌐 **현지화 UI** | 영어(기본) + 한국어, `l10n/*.json` 기반. `hmm-code.language` = `auto`/`en`/`ko` (`auto`는 VS Code 표시 언어를 따름). |
| 🗂️ **세션 피커** | 부모-자식 트리 + 이름변경 + 연쇄 삭제. 활성 세션 삭제 시 대체 세션 자동 생성. |
| ✨ **자동 제목 생성** | 첫 메시지 쌍 → GPT-mini → 세션 제목 (동봉된 Pi 확장 경유). |
| 🧼 **마크다운 살균** | 모든 렌더에 DOMPurify — `<script>`, `on*` 핸들러, `javascript:` URL, `<iframe>` 제거. |

> **Claude(Anthropic) 구독 인증:** 이런 서드파티 에이전트 도구에서 Claude Pro/Max 플랜을 쓰는 것은 **2026-06-15** 부터 Anthropic이 공식 지원합니다 — [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) 참고. 그 전에는 Anthropic **API 키**(또는 다른 공급자)를 권장합니다. ChatGPT Plus/Pro(Codex) 구독 인증은 설정 패널의 OAuth 버튼으로 가능합니다.

---

## 아키텍처

```
VS Code Extension Host (Node)
  ├── pi-launcher.ts             번들 vs 사용자 override vs 시스템 pi
  ├── spawn `pi --mode rpc`      stdio JSONL 프레이밍
  │      ↑ 번들 모드는 Electron의 Node로 out/vendor/pi/dist/cli.js 실행
  │        --no-extensions -e out/vendor/hmm-code-pi/index.ts 와 함께
  ├── ChatViewProvider           사이드바 webview
  ├── ChatPanel                  에디터 영역 webview (serializer가 재로드 생존)
  ├── SettingsPanel              독립 에디터 탭
  └── ChatBackend                PiClient ↔ webview 브리지
        ├── 모델 캐시 옵저버 (설정 패널 자동 갱신)
        ├── restartAll()         모든 Pi 프로세스 재생성 (인증 변경)
        └── reloadAll()          /reload-runtime 브로드캐스트 (모드/모델 변경)

Webview (14개 모듈)
  ├── dispatch          메시지 라우터 + Pi 이벤트 핸들러
  ├── turn-lifecycle    상태 행 + 말풍선 + rAF 디바운스 마크다운 스트림
  ├── tools             인터랙티브 카드 + LCS diff + Shiki 블록
  ├── pickers           모드 / 모델 / thinking 드롭다운
  ├── modals            질문 카드 + 확인/입력 다이얼로그
  ├── session-picker    부모-자식 트리 + 이름변경 / 삭제
  ├── history           과거 메시지 재생 (별칭 인식)
  ├── prompt            전송 / 중단 + 키 핸들러 (IME 안전)
  └── helpers/dom/state/protocol/types/syntax

Pi 프로세스 (번들)
  └── -e 로 out/vendor/hmm-code-pi/index.ts 로드
        ├── plan / code / debug / ask 모드 시스템
        ├── 도구: finalize_plan / request_mode_switch / ask_user / todo_write / auto-title
        ├── 권한 레이어 (tool_call 훅)
        └── AGENTS.md 자동 주입 (before_agent_start)
```

---

## 명령

명령 팔레트(`Cmd+Shift+P`)에서 사용 — 기본 키바인딩 없음 (VS Code가 대부분의 모디파이어 조합을 webview 도달 전에 가로챔). 원하면 `keybindings.json` 에서 직접 바인딩하세요.

| 명령 | 설명 |
|---|---|
| `Hmm-code: Open Chat in Sidebar` | 사이드바 Chat 뷰에 포커스 |
| `Hmm-code: New Chat Panel` | 에디터 탭에 새 대화 열기 |
| `Hmm-code: Open Settings` | 설정 패널을 에디터 탭으로 열기 |
| `Hmm-code: Cycle Mode` | `/mode` 와 동일 |
| `Hmm-code: Toggle Thinking Level` | `/thinking-toggle` 와 동일 |
| `Hmm-code: Reset Model + Thinking to Mode Defaults` | `/reset` 와 동일 |
| `Hmm-code: Cancel Current Turn` | 진행 중인 Pi 응답 중단 |

프롬프트 텍스트영역 안에서 `Tab` / `Shift+Tab` 으로 모드를 순환합니다 (webview가 직접 처리, VS Code 키바인딩 미사용).

---

## 문서

| | |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 모든 기능의 UI 안내 |
| [docs/SETTINGS.md](docs/SETTINGS.md) | 설정 패널 레퍼런스 |
| [RELEASING.md](RELEASING.md) | 릴리즈 절차 (메인테이너용) |
| [CHANGELOG.md](CHANGELOG.md) | 릴리즈 노트 |

Pi 쪽 문서 (워크플로 / 권한 / AGENTS.md):
- [hmm-code-pi WORKFLOW](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/WORKFLOW.md)
- [hmm-code-pi PERMISSIONS](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/PERMISSIONS.md)
- [hmm-code-pi AGENTS-MD](https://github.com/lbm1202/hmm-code-pi/blob/main/docs/AGENTS-MD.md)

---

## 구조

```
hmm-code-vscode/
├── src/
│   ├── extension.ts          activate() — 런치 설정 + 뷰/패널/명령 등록
│   ├── pi-launcher.ts        번들 / 사용자 override / 시스템 Pi 결정
│   ├── chat-view.ts          사이드바 WebviewView 공급자
│   ├── chat-panel.ts         에디터 영역 WebviewPanel + serializer
│   ├── settings-panel.ts     독립 에디터 탭 — 모드 / 모델 / 인증
│   ├── chat-backend.ts       PiClient ↔ webview 브리지
│   ├── pi-client.ts          spawn pi --mode rpc, JSONL 프레이밍, EventEmitter
│   ├── protocol.ts           webview 메시지 종류 + STATUS_KEYS
│   ├── rpc-types.ts          Pi RPC 타입 별칭
│   ├── oauth-codex.ts        OpenAI Codex OAuth 흐름
│   └── session-manager.ts    세션 열거 + 연쇄 삭제
├── webview/                  14개 모듈 — 위 아키텍처 참고
├── .github/
│   ├── workflows/release.yml CI: 태그 push → 빌드 → .vsix 첨부 릴리즈
│   └── dependabot.yml        주간 @earendil-works + 런타임 의존성 업데이트 PR
└── esbuild.config.mjs        확장 + webview 번들 + Pi vendor 복사
```

---

## 라이선스

MIT — [LICENSE](LICENSE) 참고.

## 감사의 말

- [Pi coding agent](https://github.com/badlogic/pi-mono) — 우리가 감싸는 실제 코딩 에이전트
- [Kilo Code](https://github.com/Kilo-Org/kilocode) — 권한 규칙 패턴 (MIT, 동반 Pi 확장에서 사용)
- [Shiki](https://shiki.style/) — 문법 강조
- [DOMPurify](https://github.com/cure53/DOMPurify) — 마크다운 HTML 살균
- [marked](https://marked.js.org/) — 마크다운 렌더링

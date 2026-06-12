<div align="center">

<img src="media/icon.png" alt="Hmm-code" width="128" />

# Hmm-code

**[Pi 코딩 에이전트](https://github.com/badlogic/pi-mono)를 위한 네이티브 VS Code UI.**
plan / code / debug / ask 모드 · 권한 레이어 · AGENTS.md 자동 주입 · 자체 완결형 `.vsix`

[![Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/lbm1202/hmm-code-vscode/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue.svg)](https://code.visualstudio.com/)
[![Release](https://img.shields.io/github/v/release/lbm1202/hmm-code-vscode?label=release)](https://github.com/lbm1202/hmm-code-vscode/releases)
[![Pi-coding-agent](https://img.shields.io/github/package-json/dependency-version/lbm1202/hmm-code-vscode/dev/@earendil-works/pi-coding-agent?label=Pi&color=purple)](https://github.com/badlogic/pi-mono)

[English](README.md) · **한국어**

[설치](#설치) · [무엇을-하는가](#무엇을-하는가) · [문서](#문서) · [Pi 확장](https://github.com/lbm1202/hmm-code-pi)

</div>

---

> ⚠️ **베타.** Hmm-code는 활발히 개발 중입니다 — 거친 부분과 릴리스 간 호환성 깨짐이 있을 수 있습니다. 버그 제보와 피드백 환영합니다.

> 에디터를 떠나지 않고 VS Code 패널에서 Pi 코딩 에이전트 세션을 다룹니다 — 모드 인식 diff, 계획 우선 워크플로, 권한 프롬프트, 세션 히스토리.

---

## 설치

### VS Code 마켓플레이스에서 설치 (권장)

확장 뷰(`Cmd/Ctrl+Shift+X`)를 열고 **Hmm-code** 를 검색해 **설치**를 누르거나, Quick Open(`Cmd/Ctrl+P`)에 다음을 붙여넣으세요:

```
ext install lbm1202.hmm-code
```

마켓플레이스: <https://marketplace.visualstudio.com/items?itemName=lbm1202.hmm-code>

설치 후 Activity Bar의 Hmm-code 아이콘을 클릭하거나, 명령 팔레트에서 "Hmm-code: Open Chat in Sidebar" 를 실행합니다.

### 릴리즈 `.vsix`에서 설치

**code-server, VSCodium, Cursor** 등 Open VSX에서 확장을 받는 에디터(Hmm-code가 게시되어 있지 **않음**)에서는 번들 `.vsix`를 직접 설치하세요:

```bash
# GitHub Releases에서 최신 .vsix 받기
curl -L -o hmm-code.vsix \
  "$(curl -s https://api.github.com/repos/lbm1202/hmm-code-vscode/releases/latest \
     | grep browser_download_url | cut -d'"' -f4)"

# VS Code 데스크톱
code --install-extension hmm-code.vsix
# …또는 code-server
# code-server --install-extension hmm-code.vsix --force
```

또는 <https://github.com/lbm1202/hmm-code-vscode/releases> 에서 받아 확장 패널 → `…` 메뉴 → **Install from VSIX…** 로 설치하세요.

### 소스에서 빌드
두 저장소를 나란히 클론합니다 (빌드는 `hmm-code-pi`가 `hmm-code-vscode`의 형제 디렉터리에 있다고 가정):
```bash
git clone https://github.com/lbm1202/hmm-code-pi.git
git clone https://github.com/lbm1202/hmm-code-vscode.git
cd hmm-code-vscode
npm install
npm run build           # Pi 런타임 + hmm-code-pi를 out/vendor/ 로 번들
npx @vscode/vsce package
code --install-extension "hmm-code-$(node -p "require('./package.json').version").vsix" --force
```

형제 디렉터리가 없으면 빌드가 `hmm-code-pi`를 `node_modules/.cache/` 로 자동 클론합니다. 다른 위치의 기존 클론을 쓰려면 `HMM_CODE_PI_PATH=/path/to/clone` 으로 지정하세요.

---

## 무엇을 하는가

위젯이 아니라 워크플로우가 핵심인, 모드 기반의 규율 있는 코딩 에이전트:

- **4개 명시적 모드** — `plan` · `code` · `debug` · `ask`. 각 모드가 독립된 모델 · thinking 레벨 · 도구 · 시스템 프롬프트를 가짐. 피커로 직접 전환하거나, 에이전트가 제안한 전환을 사용자가 승인.
- **설계상 plan 우선** — 모든 코드 변경은 `plan → code`를 거침. `plan`/`debug`/`ask`는 edit·write 불가. 오직 `code`만 파일을 건드리며, 그것도 plan 핸드오프(`finalize_plan`) 이후에만.
- **권한 게이팅** — 계층형 권한 시스템이 도구 호출마다 `allow` / `ask` / `deny`를 결정(모드 기본값 + `.piignore`)하고 확인 프롬프트로 표시. 빠르게 진행하고 싶을 땐 세션 단위 **자동 승인**.
- **다이나믹 압축** — 에이전트의 턴 도중에 끊지 않고 턴 경계에서 컨텍스트를 자동 요약(토글 + 50–85% 임계값, 수동 **Compact** 버튼).

모드 시스템, plan 핸드오프, 권한 레이어는 동봉된 [hmm-code-pi](https://github.com/lbm1202/hmm-code-pi) 확장에서 옵니다 — 이 repo는 그것의 네이티브 VS Code UI입니다.

## 에디터에서

인터랙티브 도구 카드 · 문법 강조 edit/write diff([Shiki](https://shiki.style/)) · 모드 + 모델 피커 · 권한 모달 · 부모-자식 세션 히스토리 · 탭형 설정 패널(인증 / 모델 / 모드 / 프롬프트) · 영어 + 한국어 UI · 자체 완결형 `.vsix`(별도 Pi 설치 불필요).

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

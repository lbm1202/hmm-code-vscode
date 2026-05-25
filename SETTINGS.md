# 설정 패널 가이드

`Cmd+Shift+P` → "Hmm-code: Open Settings" 또는 채팅 푸터의 ⚙ 버튼.

별도 편집기 탭으로 열리고, 모든 변경사항은 화면 우하단 "저장" 버튼으로
한꺼번에 저장됨. dirty 표시 (보더 강조) 가 변경된 카드에 뜸.

저장 후 자동 reload — auth 변경은 모든 Pi 프로세스 재시작
(`restartAll`), modes/models 변경은 `/reload-runtime` broadcast
(`reloadAll`). 모든 채팅 탭이 새 설정 즉시 적용.

---

## 1. 모드

각 모드 (plan / code / debug / ask) 별 model + thinking level 편집.

```
┌──────────────────────────────────────────────────────────┐
│ plan   │ [공급자 ▾]      [모델 ▾]      [thinking ▾]    │
│ code   │ [공급자 ▾]      [모델 ▾]      [thinking ▾]    │
│ debug  │ [공급자 ▾]      [모델 ▾]      [thinking ▾]    │
│ ask    │ [공급자 ▾]      [모델 ▾]      [thinking ▾]    │
└──────────────────────────────────────────────────────────┘
```

### 공급자 dropdown
- `(default)` — 모드 default 모델 사용
- 등록된 모든 공급자 (Pi 내장 + 커스텀)

### 모델 dropdown
- 선택된 공급자의 모델 목록
- **alias 가 있으면 alias 표시** — 예: `Hmm` (raw id `Qwen3.6-35B-A3B-MLX-VL-oQ5`)
- raw id 는 hover title 로 노출
- **모델 필터 적용됨** — 공급자별 모델 필터에서 hidden 처리한 모델은
  여기서도 안 보임 (단 이미 선택된 hidden 모델은 유지 — modelOptionsHtml
  의 currentValue inject)

### thinking dropdown
- 모델이 지원하는 thinking level만 (모델별 `thinkingLevelMap` 기준)
- `(default)` = 모드 default

---

## 2. 기타 모델 설정

### 자동 제목 모델
세션 자동 제목 생성에 쓸 모델 (`auto-title.ts`).

- 빈 값: GPT-mini 후보 → code 모드 모델 → 활성 모델 순으로 fallback
- 지정: 그 모델 강제 사용 (`modes.json:autoTitle.{provider,id}` 저장)

`Pi 가 컨텍스트 요약 (compact) 에 어떤 모델을 쓰지?` — 항상 **현재
활성 모델**. Pi 내부 로직이라 따로 설정 불가.

---

## 3. 공급자별 모델 필터

채팅의 모델 picker 에 보일 모델을 공급자별로 화이트리스트.

```
┌──────────────────────────────────────────────────────────┐
│ Hmmgent                          전체 1 노출   [전체][해제]│
│  ☑ Hmm                                                   │
├──────────────────────────────────────────────────────────┤
│ openai-codex                     1 / 6 노출   [전체][해제]│
│  ☐ gpt-5.2  ☐ gpt-5.3-codex  ☐ gpt-5.3-codex-spark      │
│  ☐ gpt-5.4  ☐ gpt-5.4-mini   ☑ gpt-5.5                   │
└──────────────────────────────────────────────────────────┘
```

### 동작 의미

| 상태 | 결과 |
|---|---|
| 전부 체크 | 필터 없음 — 그 공급자의 모든 모델 노출 (key 자체가 modes.json 에서 사라짐) |
| 일부 체크 | 그 모델들만 picker / 모드 dropdown 에 노출 |
| 전부 해제 | 그 공급자 0개 노출 (= `[]` 로 저장, 명시적 hide-all) |

[전체] / [해제] 버튼은 그 공급자 일괄 토글.

### 적용 범위

- ✅ 채팅의 모델 picker
- ✅ 설정의 모드 모델 dropdown
- ✅ 설정의 자동 제목 dropdown
- ❌ 이 필터 UI 자체 (그러면 본인이 본인을 못 토글)

이미 선택돼있는 hidden 모델은 dropdown 에 그대로 유지됨 — modelOptionsHtml
이 currentValue 를 보고 추가 노출.

저장 위치: `~/.pi/agent/modes.json` 의 `modelAllowlist` 필드. 키 없으면
필터 없음 (전체 노출).

---

## 4. 공급자 인증 (auth.json)

Pi 의 `AuthStorage` (= `~/.pi/agent/auth.json`) 편집 UI.

### API key 추가
- provider id (예: `openai`, `anthropic`, `groq`) + API key 입력
- "Add" 클릭 — 즉시 메모리 draft 에 추가, 저장 시 디스크 반영
- 인라인 추가 — modal 안 뜸

### OAuth 로그인 (openai-codex)
- "Codex 로그인" 버튼 → 브라우저 OAuth 플로우 자동 시작
  (127.0.0.1:1455 callback)
- 성공 시 status panel 에 표시 + 모든 Pi 프로세스 재시작 (auth.json
  메모리 캐시 갱신용)
- 취소 가능 (인증 도중 abort 버튼)

### 제거
- 각 row 의 ✕ 버튼

### 보안
- Webview 에는 API key VALUE 안 전달 — type 만 ("api_key" / "oauth")
- 디스크 파일도 권한 0600 으로 저장

---

## 5. 커스텀 공급자 (models.json)

vLLM / Ollama / 자체 호스팅 OpenAI 호환 endpoint 등록.

```
┌─────────────────────────────────────────┐
│ + 공급자 추가                            │
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │ Hmmgent                              │ │
│ │  baseUrl: https://api.hmmgent.com/v1 │ │
│ │  apiKey:  ************              │ │
│ │  api:     openai-completions ▾      │ │
│ │                                      │ │
│ │  모델                                │ │
│ │  #  ID                  이름  추론 ✕│ │
│ │  1  Qwen3.6-35B-...-oQ5  Hmm   ☑   ✕│ │
│ │  2  Qwen3.6-27B-oQ6      Hmmpus ☐  ✕│ │
│ │  [+ 수동 추가]  [모델 발견]          │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 공급자 추가
- "+ 공급자 추가" → 새 카드 생성 (자동 이름 placeholder)
- `baseUrl` + `apiKey` + `api` (openai-completions / anthropic-messages
  등) 입력

### 모델 row
| 필드 | 의미 |
|---|---|
| ID | 모델 id (필수) — provider 의 실제 모델 이름 |
| 이름 | alias / 친화 라벨 (예: "Hmm"). 비우면 alias 없음 |
| 추론 | 모델이 reasoning/thinking 지원하면 체크. 토글 시 `models.json` 에 `"reasoning": true` 저장 |
| ✕ | row 제거 |

**모델 이름이 alias** — 채팅 picker 와 mode dropdown 에서 alias 가 보임.
별도 alias UI 없음 (예전엔 있었는데 제거됨 — model.name 이 단일 소스).

### 모델 발견 (auto-discovery)
- "모델 발견" 버튼 → `${baseUrl}/models` 엔드포인트 호출 (OpenAI-호환)
- 응답의 id 목록을 체크박스로 표시
- 일괄 선택 가능 — 이미 등록된 모델은 자동 체크
- "추가" → 선택된 모델들 자동 등록 (기본값 reasoning=false)

저장 위치: `~/.pi/agent/models.json`.

---

## 6. 저장 동작 상세

저장 버튼 (우하단 fixed 바) 은 dirty 변경이 있을 때만 노출.

```
저장 (3개 모드 · 자동 제목 모델 · 모델 필터)  [저장]
```

내부 동작:
1. `models.json` 먼저 쓰기 (alias 가 modes.json 의 modelAliases 로
   파생되므로)
2. 그 alias 를 모아서 `modes.json` 의 modelAliases 갱신 + 다른 mode
   설정 / autoTitle / modelAllowlist 동시 저장
3. `auth.json` 변경 분 적용 (adds + removes)
4. 라우팅:
   - **auth 변경** → `restartChat` (= `ChatBackend.restartAll`) — 모든
     Pi 프로세스 재시작
   - **modes/models 만 변경** → `ChatBackend.reloadAll()` — 모든 백엔드에
     `/reload-runtime` slash broadcast + 800ms 후 fresh 모델 자동 pull
5. 모든 채팅 탭이 새 설정 즉시 적용

저장 토스트 + 저장된 파일 목록 (`modes.json`, `models.json`, `auth.json`)
표시.

---

## 7. 캐시 / 동기화

- **모델 캐시**: `ChatBackend._cachedModels` (정적 필드) — 어느 채팅
  탭에서 모델 fetch 가 일어나면 모든 탭 + settings 패널이 공유
- **Settings observer**: 모델 캐시 갱신 시 자동으로 settings 패널이
  refresh — 처음 열린 settings 패널의 dropdown 이 자동 채워짐
- **첫 진입 자동 fetch**: settings 가 cache 비어있는 상태로 열리면
  첫 live backend 에 자동 모델 요청 → observer 가 refresh 트리거

---

## 8. 트러블슈팅

### 저장 후 채팅에 반영 안 됨
- modes/models 만 바꾸면 `/reload-runtime` 으로 충분 (Pi 가 살아있고
  설정 파일만 다시 읽음)
- 만약 새 모델이 등록됐는데 안 보이면: Pi 의 `modelRegistry.refresh()`
  가 `session_start(reason="reload")` 때 자동 호출되는데, 그게 안 되면
  채팅 탭 재시작 (↺ 버튼) 시도

### Codex 로그인 후 모델 안 뜸
- 정상이라면 로그인 성공 시 자동 `restartChat` → 모든 Pi 재시작 →
  새 auth 로 codex 모델 노출됨
- 그래도 안 뜨면 윈도우 reload

### Settings 의 모델 dropdown 이 비어있음
- 한 번도 채팅을 안 연 상태일 가능성 — 채팅 탭 한 번 열면 자동 fetch
- 또는 cache observer 가 timing race 로 놓침 — 다시 settings 열기

### 자동 제목 모델 변경이 적용 안 됨
- modes.json 의 autoTitle 필드 직접 확인 (`cat ~/.pi/agent/modes.json |
  jq .autoTitle`)
- 비어있으면 fallback chain (GPT-mini 후보 → code 모드 모델 → 활성)
  적용됨

### 커스텀 공급자가 등록 안 됨
- baseUrl 응답이 OpenAI 호환 format 인지 확인 (`/models` endpoint 가
  `{ data: [{id, ...}] }` 반환해야 발견 가능)
- API key 없으면 발견 + 사용 모두 실패

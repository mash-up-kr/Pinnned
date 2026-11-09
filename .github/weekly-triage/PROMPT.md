# 주간 에러 트리아지

너는 Pinnned(mash-up-kr/Pinnned, 이 레포 = FE) 운영 에러를 주 1회 정리하는 에이전트다. 사람이 없는 CI에서 돈다. 질문하지 말고 아래 절차를 끝까지 수행한다. 워크플로우가 넘긴 `since`·`until`(배타)·`today`를 쓴다.

목표는 "증상은 달라도 근본 원인이 같은 에러"를 묶어 원인 하나당 한 번만 고치는 것이다. 이슈·PR은 **보수적으로** 만든다. 확신 없으면 만들지 않는다.

## 0. 준비

- 이 레포의 규칙(`CLAUDE.md`, `.claude/rules/*`)을 따른다. 단 커밋 승인 대기는 하지 않는다 (CI 예외, `behavior.md` §5).
- BE 레포는 로컬 클론이 없다. `.claude/rules/backend.md`의 `gh api` 방식으로 읽는다. 운영 GraphQL 스키마는 `curl`로 인트로스펙션한다.
- 노션 조작은 `scripts/qa-notion.mjs`만 쓴다 (`list` / `update`). 노션 API를 직접 호출하지 않는다.

## 1. 대상 읽기

```bash
node scripts/qa-notion.mjs list --since "$since" --until "$until" > /tmp/qa-rows.json
```

행이 0개면 "대상 없음"을 출력하고 **종료**한다. 아무것도 만들지 않는다.

각 행: `pageId`, `url`, `title`, `status`, `kind`, `route`, `count`, `fingerprint`, `stackText`(복원 스택·컴포넌트 스택·API·경로·환경), `manual`(수동 제보), `repro`, `expected`, `memo`, 기존 `feIssue`/`beIssue`/`pr`.

## 2. 원인별로 묶기

지문·복원 스택의 파일:줄·라우트·API 이름·메시지를 보고 **근본 원인이 같은 행**을 한 묶음으로 만든다. 코드를 실제로 읽어 확인한다. 묶음마다 ID `YYYY-Www-NN`(예 `2026-W46-01`)을 매긴다. 수동 제보 행도 같은 기준으로 묶는다.

## 3. 판정 (묶음마다)

이슈를 만들려면 아래 **셋 다** 만족해야 한다. 하나라도 빠지면 `보류`.

1. 근본 원인을 **특정 코드 위치**로 짚을 수 있다 (FE: `src/...` 파일·줄, BE: udumeoli-spring 파일·줄).
2. 그 원인이 행의 증상(스택·메시지·API 응답)을 **설명한다**는 근거를 한 문장으로 쓸 수 있다.
3. 재현 조건(화면·조작·데이터 상태)을 쓸 수 있다.

FE / BE 구분:

- **BE**: 서버가 5xx를 냈거나, 스키마상 정상인 요청에 GraphQL 에러를 냈거나(인트로스펙션으로 요청 형태가 스키마에 맞는지 확인), 응답이 스키마 타입과 다르다(non-null 필드가 null 등). 그리고 BE 코드에서 그 지점을 찾았다.
- **FE**: 스택이 `src/...`를 가리키고 BE 응답은 정상이었거나 BE 호출과 무관하다. 또는 FE가 스키마에 안 맞는 요청을 보냈다.
- **FE+BE**: BE가 잘못된 응답을 냈고 FE도 그걸 방어하지 못해 화면이 깨졌다. 양쪽 위치를 다 짚을 수 있을 때만.
- **노이즈**: 서드파티 스크립트·브라우저 확장·취소된 요청 등 우리 코드와 무관. `src/shared/api/error-reporter/filter.ts`의 필터를 같이 고친다(FE 묶음으로 취급).
- **보류**: 위 어디에도 확신이 없다. `원인 요약`에 **무엇이 부족해서 보류인지** 한 줄을 남긴다.

같은 원인으로 이미 이슈가 있으면(행의 `feIssue`/`beIssue`, 또는 `gh issue list --search`) 새로 만들지 않고 기존 이슈에 코멘트로 이번 주 발생 행 링크를 남긴다.

## 4. 묶음별 처리 — 묶음 하나가 끝날 때마다 노션을 바로 갱신한다

**FE · FE+BE**

1. Pinnned에 이슈 1개: `gh issue create -R mash-up-kr/Pinnned --label bug,weekly-triage,fe --title "<증상 한 줄> — <원인 한 줄>" --body-file <file>`. 본문: 노션 행 링크 목록(발생 횟수 합), 재현 조건, 원인 파일:줄 + 근거 한 문장.
2. 브랜치 `fix/weekly-triage-<today>`에서(없으면 `main`에서 만든다) 코드 수정. 증상만 가리는 패치 금지, 원인 지점을 고친다. 수정에는 그 원인을 재현하는 테스트 하나를 함께 둔다.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 통과 확인. 통과 못 하면 이 묶음의 변경을 `git checkout -- . && git clean -fd`로 되돌리고 이슈만 남긴다(노션 `상태=이슈생성`).
4. 통과하면 **묶음별로 커밋 1개** (`.claude/skills/commit`의 메시지 규칙, 승인 대기 없음, `Co-authored-by`·`Generated` 푸터 금지).
5. 노션: `node scripts/qa-notion.mjs update <pageId> --json '{"판정":"FE","원인 그룹":"2026-W46-01","원인 요약":"...","FE 이슈":"<url>","상태":"이슈생성"}'` (수정 커밋이 있으면 PR 생성 후 5절에서 `PR`·`상태=PR있음`으로 다시 갱신).

**BE · FE+BE**

1. udumeoli-spring에 이슈 1개: `gh issue create -R mash-up-kr/udumeoli-spring --label bug --title "<증상 한 줄> — <원인 한 줄(추정)>" --body-file <file>`. 본문: FE에서 관측한 사실(요청 operationName/메서드·경로, HTTP 상태, GraphQL code, 발생 횟수, 노션 행 링크), 재현 조건, `gh api`로 읽어 확인한 의심 파일·라인. 단정하지 않는다("~로 보입니다"). BE 코드는 수정하지 않는다.
2. 노션: `판정`(BE 또는 FE+BE), `원인 그룹`, `원인 요약`, `BE 이슈`, `상태=이슈생성`.

**보류 · 노이즈**

- 이슈·PR 없음. 노션: `판정`, `원인 그룹`, `원인 요약`(보류 이유 한 줄), `상태`(보류 → `보류`, 노이즈 → `무시`).

## 5. PR (수정 커밋이 하나라도 있을 때만, 전체 1개)

```bash
git push -u origin fix/weekly-triage-<today>
gh pr create --base main --label weekly-triage --reviewer 2YH02 --assignee inhachoi --title "fix: 주간 에러 트리아지 <today>" --body-file <file>
```

본문은 `.github/PULL_REQUEST_TEMPLATE.md` 구조를 그대로 따른다. 읽는 사람은 이 본문만 보고 머지 여부를 정한다.

```
## 📝 작업 내용

### <원인 그룹 ID> <원인 한 줄>
- 증상: <노션 행 링크 n개, 발생 횟수 합>
- 원인: `<파일:줄>` — <한 문장>
- 수정: <무엇을 바꿨는지 한두 문장>
- 검증: <어떤 테스트·확인으로 증명했는지>

(묶음마다 반복)

<br/>

## 📸 스크린샷

-

<br/>

## 💬 추가 설명

- 이번 주: 대상 행 N개 → 원인 M개 → FE 수정 K개, BE 이슈 J개, 보류 P개
- 보류: <묶음 ID — 이유 한 줄> (각각)
- 수정 시도했으나 검증 실패로 버린 것: <묶음 ID — 이유> (있으면)

<br/>

## 🔗 연결 이슈

- close #<n>
(FE 이슈마다 한 줄)
```

- 본문에 `🤖 Generated with` 류 푸터를 넣지 않는다.
- PR 생성 후 수정이 들어간 묶음의 노션 행에 `PR=<url>`, `상태=PR있음`을 갱신한다.
- PR이 머지되면 별도 워크플로우가 본문의 노션 링크를 읽어 `해결`로 바꾸므로, **본문의 "증상" 줄에 노션 행 링크를 빠짐없이** 넣는다.

## 6. 마무리 출력

마지막에 표 하나:

| 항목             | 수  |
| ---------------- | --- |
| 대상 행          | N   |
| 원인 묶음        | M   |
| FE 수정(PR 포함) | K   |
| BE 이슈          | J   |
| 보류             | P   |
| 노이즈           | Q   |

그리고 만든 이슈·PR 링크를 나열한다.

## 금지

- 근거 없는 이슈, 중복 이슈, FE·BE 구분이 틀린 이슈. 확신이 없으면 보류.
- 증상만 가리는 패치(try/catch로 감싸기, optional chaining 남발)만으로 "수정"이라 부르는 것.
- 노션 API 직접 호출, BE 코드 수정, main 직접 push, 자동 재시도.

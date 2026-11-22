---
paths:
  - "src/pages/**"
  - "src/widgets/**"
  - "src/features/**"
  - "src/entities/**"
  - "src/shared/api/**"
---

# 팀 위키 (제품 규칙 · FE↔BE 계약 · 결정)

제품 동작이나 BE 연동을 바꾸기 전에 팀 위키 목차를 읽고 해당하는 쪽만 골라 연다. 전체를 읽지 않는다. 바깥 동작이 그대로인 작업(내부 리팩터링, 스타일, 테스트)은 읽지 않는다. 위키: https://github.com/inhachoi/pinnned-llm-wiki

```bash
# 옆 폴더에 클론이 있으면 ../pinnned-llm-wiki/wiki/index.md 를 읽는다. 없으면:
gh api repos/inhachoi/pinnned-llm-wiki/contents/wiki/index.md --jq .content | base64 -d
gh api repos/inhachoi/pinnned-llm-wiki/contents/wiki/<쪽 경로> --jq .content | base64 -d
```

- 계획과 결과에 근거 ID를 남긴다 (`D-003`, `SPEC-04 §6`, `Q07`). `status: draft` 쪽은 단서로만 쓴다.
- 지금 어떻게 동작하나는 코드·배포본이, 어떻게 동작해야 하나는 위키의 확정 결정이 기준이다. 둘이 다르면 고르지 말고 보고한다.
- 위키가 코드와 다른 것을 발견하거나, 작업 중 확정된 규칙·계약 변경이 생기면 PR 본문 "추가 설명"에 `wiki: <한 줄>`을 남긴다.

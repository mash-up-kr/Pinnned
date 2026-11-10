#!/usr/bin/env node
// 노션 QA DB 조작 (CI·로컬 공용, 의존성 없음). env: NOTION_TOKEN, NOTION_QA_DB_ID
//   node scripts/qa-notion.mjs create-db --parent <pageId>            DB 생성, ID 출력
//   node scripts/qa-notion.mjs list --since <ISO> --until <ISO>        주간 대상 행 JSON 배열
//   node scripts/qa-notion.mjs update <pageId> --json '{"원인 요약":"...","FE 이슈":"<url>"}'
//   node scripts/qa-notion.mjs resolve --pr-body-file <path>           본문의 노션 링크 행을 Done으로
import { readFileSync } from "node:fs"

import {
  buildListFilter,
  createDbProperties,
  createNotionApi,
  extractNotionPageIds,
  flattenPage,
  toNotionProperty,
} from "./qa-notion/lib.mjs"

const [command, ...rest] = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i]
  else positional.push(rest[i])
}

const token = process.env.NOTION_TOKEN
if (!token) fail("NOTION_TOKEN이 없다")
const api = createNotionApi(token)
const databaseId = () =>
  process.env.NOTION_QA_DB_ID || fail("NOTION_QA_DB_ID가 없다")

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function queryAll(path, body) {
  const results = []
  let cursor
  do {
    const page = await api.call("POST", path, { ...body, start_cursor: cursor })
    results.push(...page.results)
    cursor = page.has_more ? page.next_cursor : undefined
  } while (cursor)
  return results
}

const richText = (rich) => (rich ?? []).map((r) => r.plain_text).join("")

/** 페이지 본문을 평문으로. 토글("개발자 참고") 안은 한 단계 내려가 읽는다. */
async function readBody(pageId) {
  const blocks = await api.call(
    "GET",
    `/blocks/${pageId}/children?page_size=100`
  )
  const lines = []
  for (const block of blocks.results) {
    const content = block[block.type]
    if (content?.rich_text) lines.push(richText(content.rich_text))
    if (block.type === "toggle" && block.has_children) {
      const inner = await api.call(
        "GET",
        `/blocks/${block.id}/children?page_size=100`
      )
      for (const child of inner.results) {
        const c = child[child.type]
        if (c?.rich_text) lines.push(richText(c.rich_text))
      }
    }
  }
  return lines.join("\n")
}

const commands = {
  async "create-db"() {
    const parent = flags.parent ?? fail("--parent <pageId>가 필요하다")
    const db = await api.call("POST", "/databases", {
      parent: { type: "page_id", page_id: parent },
      title: [{ type: "text", text: { content: "QA 이슈" } }],
      properties: createDbProperties(),
    })
    console.log(db.id.replaceAll("-", ""))
  },

  async list() {
    const since = flags.since ?? fail("--since <ISO>가 필요하다")
    const until = flags.until ?? fail("--until <ISO>가 필요하다")
    const pages = await queryAll(`/databases/${databaseId()}/query`, {
      filter: buildListFilter(since, until),
      sorts: [{ property: "마지막 발생", direction: "descending" }],
    })
    const rows = []
    for (const page of pages)
      rows.push(flattenPage(page, await readBody(page.id)))
    console.log(JSON.stringify(rows, null, 2))
  },

  async update() {
    const pageId = positional[0] ?? fail("<pageId>가 필요하다")
    const values = JSON.parse(flags.json ?? fail("--json이 필요하다"))
    const properties = Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        toNotionProperty(name, value),
      ])
    )
    await api.call("PATCH", `/pages/${pageId}`, { properties })
    console.log(`updated ${pageId}: ${Object.keys(values).join(", ")}`)
  },

  async resolve() {
    const file =
      flags["pr-body-file"] ?? fail("--pr-body-file <path>가 필요하다")
    const ids = extractNotionPageIds(readFileSync(file, "utf8"))
    if (ids.length === 0) return console.log("노션 링크 없음")
    for (const id of ids) {
      try {
        await api.call("PATCH", `/pages/${id}`, {
          properties: { 진행: toNotionProperty("진행", "Done") },
        })
        console.log(`Done: ${id}`)
      } catch (error) {
        // 링크 하나가 DB 자체나 보관된 페이지여도 나머지 행은 계속 처리한다
        console.error(`건너뜀 ${id}: ${error.message}`)
      }
    }
  },
}

const run = commands[command]
if (!run)
  fail(`알 수 없는 명령: ${command}. create-db | list | update | resolve`)
run().catch((error) => fail(error.message))

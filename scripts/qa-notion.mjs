#!/usr/bin/env node
// 노션 QA DB 조작 (CI·로컬 공용, 의존성 없음). env: NOTION_TOKEN, NOTION_QA_DB_ID
//   node scripts/qa-notion.mjs create-db --parent <pageId>            DB 생성, ID 출력
//   node scripts/qa-notion.mjs list --since <ISO> --until <ISO>        주간 대상 행 JSON 배열
//   node scripts/qa-notion.mjs update <pageId> --json '{"상태":"PR있음",...}'
//   node scripts/qa-notion.mjs resolve --pr-body-file <path>           본문의 노션 링크 행을 "해결"로
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

/** 페이지 본문의 code 블록 텍스트 (2,000자 넘는 스택 전체) */
async function readCodeBlocks(pageId) {
  const blocks = await api.call("GET", `/blocks/${pageId}/children?page_size=100`)
  return blocks.results
    .filter((b) => b.type === "code")
    .map((b) => b.code.rich_text.map((r) => r.plain_text).join(""))
    .join("\n")
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
    for (const page of pages) {
      const stackProp = page.properties["복원 스택"]?.rich_text ?? []
      const body =
        stackProp.length && stackProp[0].plain_text.length >= 2000
          ? await readCodeBlocks(page.id)
          : ""
      rows.push(flattenPage(page, body))
    }
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
    const file = flags["pr-body-file"] ?? fail("--pr-body-file <path>가 필요하다")
    const ids = extractNotionPageIds(readFileSync(file, "utf8"))
    if (ids.length === 0) return console.log("노션 링크 없음")
    for (const id of ids) {
      await api.call("PATCH", `/pages/${id}`, {
        properties: { 상태: toNotionProperty("상태", "해결") },
      })
      console.log(`해결: ${id}`)
    }
  },
}

const run = commands[command]
if (!run) fail(`알 수 없는 명령: ${command}. create-db | list | update | resolve`)
run().catch((error) => fail(error.message))

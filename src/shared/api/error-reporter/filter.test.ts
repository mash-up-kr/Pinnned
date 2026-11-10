import { describe, expect, it } from "vitest"

import { shouldIgnoreError } from "./filter"

const OWN_STACK =
  "TypeError: Cannot read properties of undefined\n    at https://www.pinnned.co.kr/assets/index-abc.js:1:100"

describe("shouldIgnoreError", () => {
  it("크로스오리진 스크립트의 'Script error.'는 무시한다", () => {
    expect(shouldIgnoreError({ message: "Script error." })).toBe(true)
  })

  it("ResizeObserver 루프 경고는 무시한다", () => {
    expect(
      shouldIgnoreError({
        message:
          "ResizeObserver loop completed with undelivered notifications.",
      })
    ).toBe(true)
    expect(
      shouldIgnoreError({ message: "ResizeObserver loop limit exceeded" })
    ).toBe(true)
  })

  it("사용자가 취소한 요청(AbortError)은 무시한다", () => {
    expect(
      shouldIgnoreError({ message: "AbortError: The user aborted a request." })
    ).toBe(true)
  })

  it("스택 프레임이 전부 Clarity면 무시한다", () => {
    expect(
      shouldIgnoreError({
        message: "x is not a function",
        stack:
          "TypeError: x is not a function\n    at https://www.clarity.ms/tag/xl5xvglqsb:1:200\n    at https://www.clarity.ms/s/0.8.1/clarity.js:2:10",
      })
    ).toBe(true)
  })

  it("스택 프레임이 전부 브라우저 확장이면 무시한다", () => {
    expect(
      shouldIgnoreError({
        message: "boom",
        stack: "Error: boom\n    at chrome-extension://abc/content.js:10:5",
      })
    ).toBe(true)
  })

  it("스택 프레임이 전부 gtag면 무시한다", () => {
    expect(
      shouldIgnoreError({
        message: "boom",
        stack:
          "Error: boom\n    at https://www.googletagmanager.com/gtag/js?id=G-1:3:4",
      })
    ).toBe(true)
  })

  it("자사 번들 프레임이 하나라도 있으면 보낸다", () => {
    expect(
      shouldIgnoreError({
        message: "Cannot read properties of undefined",
        stack:
          "TypeError: x\n    at https://www.clarity.ms/tag/x:1:1\n" + OWN_STACK,
      })
    ).toBe(false)
  })

  it("스택이 없는 일반 에러는 보낸다", () => {
    expect(shouldIgnoreError({ message: "something broke" })).toBe(false)
  })

  it("'Failed to fetch'는 스택이 없어도 보낸다 (API 실패 경로가 따로 분류)", () => {
    expect(shouldIgnoreError({ message: "Failed to fetch" })).toBe(false)
  })
})

// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ErrorReporterRuntime } from "./runtime"

const { useMatchesMock, installMock, setCurrentRouteMock } = vi.hoisted(() => ({
  useMatchesMock: vi.fn(),
  installMock: vi.fn(),
  setCurrentRouteMock: vi.fn(),
}))

vi.mock("@tanstack/react-router", () => ({
  useMatches: useMatchesMock,
}))
vi.mock("./reporter", () => ({
  installErrorReporter: installMock,
  setCurrentRoute: setCurrentRouteMock,
}))

function matchesFor(fullPath: string) {
  return [{ fullPath: "/" }, { fullPath }]
}

describe("ErrorReporterRuntime", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("마운트 시 수집기를 설치하고 현재 라우트 패턴을 기록한다", () => {
    useMatchesMock.mockReturnValue(matchesFor("/my-page/pot/$potId"))

    render(<ErrorReporterRuntime />)

    expect(installMock).toHaveBeenCalledTimes(1)
    expect(setCurrentRouteMock).toHaveBeenCalledWith("/my-page/pot/$potId")
  })

  it("라우트가 바뀌면 새 패턴을 기록한다", () => {
    useMatchesMock.mockReturnValue(matchesFor("/a"))
    const { rerender } = render(<ErrorReporterRuntime />)
    useMatchesMock.mockReturnValue(matchesFor("/b"))

    rerender(<ErrorReporterRuntime />)

    expect(setCurrentRouteMock).toHaveBeenNthCalledWith(1, "/a")
    expect(setCurrentRouteMock).toHaveBeenNthCalledWith(2, "/b")
  })
})

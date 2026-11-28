import { afterEach, describe, expect, it, vi } from "vitest"

import {
  closeMapTipsOverlay,
  isMapTipsOpen,
  registerMapTipsOverlay,
} from "./openMapTipsOverlay"

describe("지도 사용 안내 열림 상태", () => {
  afterEach(() => closeMapTipsOverlay())

  it("안내가 등록되면 열림, 해제되면 닫힘으로 본다", () => {
    expect(isMapTipsOpen()).toBe(false)
    const unregister = registerMapTipsOverlay(vi.fn())
    expect(isMapTipsOpen()).toBe(true)
    unregister()
    expect(isMapTipsOpen()).toBe(false)
  })

  it("지도를 떠날 때 부르는 closeMapTipsOverlay가 떠 있는 안내를 닫는다", () => {
    const unmount = vi.fn()
    const unregister = registerMapTipsOverlay(unmount)
    closeMapTipsOverlay()
    expect(unmount).toHaveBeenCalledOnce()
    unregister()
  })

  it("떠 있는 안내가 없으면 closeMapTipsOverlay는 아무 일도 하지 않는다", () => {
    expect(() => closeMapTipsOverlay()).not.toThrow()
  })

  it("먼저 뜬 안내의 해제가 나중에 뜬 안내의 상태를 지우지 않는다", () => {
    const unregisterFirst = registerMapTipsOverlay(vi.fn())
    const unregisterSecond = registerMapTipsOverlay(vi.fn())
    unregisterFirst()
    expect(isMapTipsOpen()).toBe(true)
    unregisterSecond()
    expect(isMapTipsOpen()).toBe(false)
  })
})

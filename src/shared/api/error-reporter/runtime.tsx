import * as React from "react"
import { useMatches } from "@tanstack/react-router"

import { getAccessToken } from "../token-storage"
import { installErrorReporter, setCurrentRoute } from "./reporter"

/** 전역 에러 훅을 한 번 설치하고, 라우트가 바뀔 때마다 라우트 패턴을 브레드크럼에 남긴다. */
export function ErrorReporterRuntime() {
  const matches = useMatches()
  const routePattern = matches.at(-1)?.fullPath

  React.useEffect(() => {
    installErrorReporter({ isAuthenticated: () => Boolean(getAccessToken()) })
  }, [])

  React.useEffect(() => {
    if (routePattern) setCurrentRoute(routePattern)
  }, [routePattern])

  return null
}

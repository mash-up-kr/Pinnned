import * as React from "react"
import { Link, useRouter } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"

import { reportError } from "@/shared/api/error-reporter"
import { Button } from "@/shared/ui/button"

/** 라우터 기본 에러 화면 — 렌더 에러를 수집기에 보고하고 복구 수단 두 개를 준다. */
export function ErrorFallback({ error, info, reset }: ErrorComponentProps) {
  const router = useRouter()

  React.useEffect(() => {
    reportError(error, {
      kind: "render-error",
      componentStack: info?.componentStack,
    })
  }, [error, info])

  return (
    <main className="flex min-h-[var(--app-vh)] w-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-h3 text-foreground">문제가 발생했어요</h1>
        <p className="text-b7 text-muted-foreground">
          잠시 후 다시 시도해 주세요.
        </p>
      </div>
      <div className="flex w-full max-w-[280px] flex-col gap-2">
        <Button
          variant="solid"
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          다시 시도
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">홈으로</Link>
        </Button>
      </div>
    </main>
  )
}

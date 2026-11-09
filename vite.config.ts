import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { nitro } from "nitro/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  server: {
    // 개발 서버에서 /graphql을 사내 서버로 프록시 — 브라우저 CORS 없이 실서버 연동
    proxy: {
      "/graphql": {
        target: "https://pinnnned.duckdns.org",
        changeOrigin: true,
      },
      // 카카오 로그인 REST API (/api/auth/*) — same-origin 상대경로 호출용
      "/api": {
        target: "https://pinnnned.duckdns.org",
        changeOrigin: true,
      },
    },
  },
  // 테스트는 항상 목 모드 — 로컬 .env의 VITE_USE_MOCK에 결과가 흔들리면 안 된다
  test: {
    env: { VITE_USE_MOCK: "true" },
  },
  // 운영 에러 스택을 /report-error 서버 라우트가 원본 소스 위치로 복원하기 위해 .map을 함께 배포한다.
  // hidden: 번들에 sourceMappingURL 주석을 남기지 않아 브라우저 devtools가 자동 로드하지 않는다.
  build: { sourcemap: "hidden" },
  define: {
    // 에러 리포트에 실리는 앱 버전 — CI(deploy.yml)에서는 커밋 SHA, 로컬은 "dev"
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      (process.env.GITHUB_SHA ?? "dev").slice(0, 7)
    ),
  },
  plugins: [
    devtools(),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      router: {
        entry: "./app/router.tsx",
        routesDirectory: "./app/routes",
        generatedRouteTree: "./routeTree.gen.ts",
      },
      // SSR 예외를 에러 리포트로 남기기 위해 서버 엔트리를 직접 둔다 (src/app/server.ts)
      server: { entry: "./app/server.ts" },
    }),
    // Vercel 배포용 서버 번들 변환 — 없으면 SSR 함수가 생성되지 않아 404 (Vercel 공식 TanStack Start 가이드)
    nitro({
      // prod에서 백엔드 직접 fetch는 CORS에 막힘 — 서버사이드 프록시로 same-origin 유지
      routeRules: {
        "/graphql": { proxy: "https://pinnnned.duckdns.org/graphql" },
        "/api/**": { proxy: "https://pinnnned.duckdns.org/api/**" },
      },
    }),
    viteReact(),
  ],
})

export default config

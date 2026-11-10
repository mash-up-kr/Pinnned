/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** vite.config.ts의 define으로 주입 — 커밋 SHA 앞 7자, 로컬은 "dev" */
  readonly VITE_APP_VERSION: string
}

import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server"
import { createServerEntry } from "@tanstack/react-start/server-entry"

// 기본 엔트리(@tanstack/react-start/server-entry)와 동일. SSR 예외 보고를 끼우기 위해 직접 둔다.
const fetch = createStartHandler(defaultStreamHandler)

export default createServerEntry({ fetch })

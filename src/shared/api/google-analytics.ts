import {
  initializeAnalytics,
  logEvent,
  setUserProperties,
} from "firebase/analytics"

import { getFirebaseApp } from "./firebase"
import type { Analytics } from "firebase/analytics"

const MEASUREMENT_ID = "G-0D3HZ92ZME"
const SCRIPT_ID = "google-analytics"
// udumeoli-app WebView가 User-Agent 끝에 붙이는 표시 (applicationNameForUserAgent)
const APP_USER_AGENT_MARKER = "PinnnedApp"

type EventParams = Record<string, string | number | boolean | null>

let firebaseAnalytics: Analytics | null = null
// 로그인 콜백처럼 GA를 일부러 늦게 켜는 화면에서 난 이벤트는 GA가 켜질 때 보낸다.
let pendingEvents: Array<[string, EventParams]> = []

declare global {
  interface Window {
    dataLayer?: Array<IArguments>
    gtag?: (...args: Array<unknown>) => void
  }
}

/** 앱(WebView)과 웹 사용자를 나눠 보도록 GA4 사용자 속성 app_platform에 넣는 값. */
export function appPlatform(): "app" | "web" {
  return navigator.userAgent.includes(APP_USER_AGENT_MARKER) ? "app" : "web"
}

/**
 * OAuth 콜백에서는 코드를 포함한 URL이 수집되지 않도록 GA 로드를 미룬다.
 * Analytics를 쓸 수 있는 상태면 true를 돌려준다 (Remote Config는 그 뒤에 초기화해야 실험 배정이 기록된다).
 */
export function initializeGoogleAnalytics(): boolean {
  if (!import.meta.env.PROD || typeof window === "undefined") return false
  if (
    window.location.pathname === "/login/callback" ||
    window.location.pathname === "/login/callback/"
  ) {
    return false
  }
  if (firebaseAnalytics || document.getElementById(SCRIPT_ID)) {
    return true
  }

  // 자체 분석과 동일하게 referrer는 origin만 사용해 인증 쿼리를 제외한다.
  const pageReferrer = document.referrer
    ? new URL(document.referrer).origin
    : ""

  const app = getFirebaseApp()
  if (app) {
    // Firebase Analytics가 gtag.js를 직접 로드한다. 수동 로더와 함께 쓰면 page_view가 두 번 찍힌다.
    // SDK는 넘긴 config 객체를 초기화 중 제자리에서 바꾸므로(firebase_origin·update·firebase_id)
    // 경로 변경마다 새 옵션으로 다시 부르면 analytics/already-initialized를 던진다. 한 번만 부른다.
    firebaseAnalytics = initializeAnalytics(app, {
      config: { page_referrer: pageReferrer },
    })
    setUserProperties(firebaseAnalytics, { app_platform: appPlatform() })
    flushPendingEvents()
    return true
  }

  // ponytail: Firebase 환경변수가 배포에 들어가면 아래 수동 gtag 로더는 지운다.
  const dataLayer = (window.dataLayer ??= [])
  window.gtag = function () {
    dataLayer.push(arguments)
  }
  window.gtag("js", new Date())
  // config보다 먼저 설정해야 첫 page_view에도 사용자 속성이 붙는다
  window.gtag("set", "user_properties", { app_platform: appPlatform() })
  window.gtag("config", MEASUREMENT_ID, { page_referrer: pageReferrer })

  const script = document.createElement("script")
  script.id = SCRIPT_ID
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)
  flushPendingEvents()
  return true
}

function dispatchEvent(eventName: string, params: EventParams): void {
  if (firebaseAnalytics) logEvent(firebaseAnalytics, eventName, params)
  else window.gtag?.("event", eventName, params)
}

function flushPendingEvents(): void {
  const events = pendingEvents
  pendingEvents = []
  events.forEach(([eventName, params]) => dispatchEvent(eventName, params))
}

/**
 * 서비스 행동을 GA4 custom event로 보낸다. 분석 서버가 GA4에서 같은 이름으로 조회하므로 이름을 바꾸지 않는다.
 * GA가 아직 켜지지 않았으면 켜질 때까지 모아 둔다.
 */
export function sendGoogleAnalyticsEvent(
  eventName: string,
  params: EventParams = {}
): void {
  if (!import.meta.env.PROD || typeof window === "undefined") return
  if (firebaseAnalytics || window.gtag) dispatchEvent(eventName, params)
  else pendingEvents.push([eventName, params])
}

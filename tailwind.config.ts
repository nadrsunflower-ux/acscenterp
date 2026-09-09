import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // 근무 일지(scheduler) 컴포넌트가 사용하는 느린 펄스(저장 버튼 강조).
      // tailwindcss-animate 가 animate-in/fade-in/slide-in-*/zoom-in-* 를 제공하고,
      // animate-pulse-slow 는 플러그인에 없으므로 여기서 직접 정의한다.
      keyframes: {
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "pulse-slow": "pulse-slow 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      colors: {
        // NEANDER ERP 토큰 — 값은 app/neander/neander.css 의 CSS 변수.
        // "R G B" 트리플이라 /50 같은 알파 변형이 그대로 된다.
        nd: {
          page: "rgb(var(--nd-bg-page) / <alpha-value>)",
          content: "rgb(var(--nd-bg-content) / <alpha-value>)",
          sunken: "rgb(var(--nd-bg-sunken) / <alpha-value>)",
          inverse: "rgb(var(--nd-bg-inverse) / <alpha-value>)",
          fg: "rgb(var(--nd-fg) / <alpha-value>)",
          "fg-2": "rgb(var(--nd-fg-2) / <alpha-value>)",
          "fg-3": "rgb(var(--nd-fg-3) / <alpha-value>)",
          "fg-4": "rgb(var(--nd-fg-4) / <alpha-value>)",
          accent: "rgb(var(--nd-accent) / <alpha-value>)",
          "accent-strong": "rgb(var(--nd-accent-strong) / <alpha-value>)",
          "accent-soft": "rgb(var(--nd-accent-soft) / <alpha-value>)",
          success: "rgb(var(--nd-success) / <alpha-value>)",
          "success-soft": "rgb(var(--nd-success-soft) / <alpha-value>)",
          warning: "rgb(var(--nd-warning) / <alpha-value>)",
          "warning-soft": "rgb(var(--nd-warning-soft) / <alpha-value>)",
          danger: "rgb(var(--nd-danger) / <alpha-value>)",
          "danger-soft": "rgb(var(--nd-danger-soft) / <alpha-value>)",
          info: "rgb(var(--nd-info) / <alpha-value>)",
          "info-soft": "rgb(var(--nd-info-soft) / <alpha-value>)",
          "success-text": "rgb(var(--nd-success-text) / <alpha-value>)",
          "warning-text": "rgb(var(--nd-warning-text) / <alpha-value>)",
          "danger-text": "rgb(var(--nd-danger-text) / <alpha-value>)",
          "info-text": "rgb(var(--nd-info-text) / <alpha-value>)",
          income: "rgb(var(--nd-series-income) / <alpha-value>)",
          expense: "rgb(var(--nd-series-expense) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "#7c5cff",
          dark: "#5b3fd6",
          light: "#efeaff",
        },
        id: {
          DEFAULT: "#7c5cff",
          light: "#efeaff",
        },
        wow: {
          DEFAULT: "#ff8a3d",
          light: "#fff0e6",
        },
      },
      // 선·그림자·반경·z·모션도 같은 CSS 변수를 본다
      borderColor: {
        "nd-line": "var(--nd-line)",
        "nd-border": "var(--nd-border)",
        "nd-strong": "var(--nd-border-strong)",
      },
      divideColor: { "nd-line": "var(--nd-line)" },
      boxShadow: {
        "nd-card": "var(--nd-shadow-card)",
        "nd-glass": "var(--nd-shadow-glass)",
        "nd-pop": "var(--nd-shadow-pop)",
        "nd-dialog": "var(--nd-shadow-dialog)",
        "nd-focus": "var(--nd-focus)",
      },
      borderRadius: {
        "nd-xl": "18px", // 사이드바·시트·큰 컨테이너
        "nd-lg": "14px", // 카드
        "nd-md": "10px", // 버튼·입력·팝오버
        "nd-sm": "6px", // 배지·안쪽 요소
      },
      fontSize: {
        "nd-display": ["28px", { lineHeight: "1.2", fontWeight: "700", letterSpacing: "-0.02em" }],
        "nd-title": ["20px", { lineHeight: "1.3", fontWeight: "700", letterSpacing: "-0.01em" }],
        "nd-section": ["15px", { lineHeight: "1.4", fontWeight: "600" }],
        "nd-body": ["14px", { lineHeight: "1.5" }],
        "nd-table": ["13px", { lineHeight: "1.4" }],
        "nd-caption": ["12px", { lineHeight: "1.4" }],
        "nd-micro": ["11px", { lineHeight: "1.35", fontWeight: "500" }],
        "nd-kpi": ["clamp(24px, 2vw, 30px)", { lineHeight: "1.1", fontWeight: "700", letterSpacing: "-0.02em" }],
      },
      zIndex: {
        "nd-sticky": "10",
        "nd-sidebar": "20",
        "nd-drawer": "30",
        "nd-dock": "40",
        "nd-popover": "50",
        "nd-dialog": "60",
        "nd-toast": "70",
      },
      transitionTimingFunction: { nd: "var(--nd-ease)" },
      transitionDuration: { nd: "200ms", "nd-fast": "120ms" },
      height: { "ctl-sm": "var(--nd-ctl-sm)", "ctl-md": "var(--nd-ctl-md)", "ctl-lg": "var(--nd-ctl-lg)" },
      minHeight: { "ctl-sm": "var(--nd-ctl-sm)", "ctl-md": "var(--nd-ctl-md)", "ctl-lg": "var(--nd-ctl-lg)" },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Roboto",
          "Helvetica Neue",
          "Segoe UI",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "Malgun Gothic",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;

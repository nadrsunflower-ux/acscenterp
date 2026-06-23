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

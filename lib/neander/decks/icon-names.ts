// 장표 내용(JSON)이 부를 수 있는 아이콘 이름 — 그림은 components/neander/deck/strategy/icons.tsx.
// 이름만 여기 두는 까닭: 올리기 검사(upload-deck)가 React 없이 이름을 확인한다.
export const DECK_ICON_NAMES = [
  "alert", "arrow", "ban", "bot", "briefcase", "building", "calculator", "calendar", "check", "question", "x",
  "clipboard", "clock", "coins", "crown", "eye", "file", "flame", "gauge", "law", "education", "handshake", "heart",
  "hourglass", "bank", "layers", "chart", "list", "lock", "pin", "megaphone", "network", "package", "percent", "piggy",
  "repeat", "rocket", "scale", "school", "send", "shieldAlert", "shield", "sparkles", "split", "store", "target",
  "trend", "trophy", "user", "userCheck", "userMinus", "users", "wallet", "zap",
] as const;

export type DeckIconName = (typeof DECK_ICON_NAMES)[number];

/** 클래스 이어 붙이기 — falsy 는 버린다 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

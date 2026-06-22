import {
  deleteField,
  type FieldValue,
  type UpdateData,
  type DocumentData,
} from "firebase/firestore";

// [생성용] Firestore는 undefined 값을 거부하므로 저장 전에 undefined 키를 제거한다.
// addDoc 경로에서만 사용 (없는 필드는 애초에 저장 안 함).
export function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(obj) as (keyof T)[]).forEach((k) => {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  });
  return out;
}

// [수정용] updateDoc은 부분 병합이라, undefined 키를 제거하면 '필드 비우기'가 무시된다.
// 따라서 undefined는 deleteField()로 변환해 실제로 필드를 삭제하도록 한다.
export function cleanForUpdate<T extends Record<string, unknown>>(
  obj: T,
): UpdateData<DocumentData> {
  const out: Record<string, unknown | FieldValue> = {};
  (Object.keys(obj) as (keyof T)[]).forEach((k) => {
    out[k as string] = obj[k] === undefined ? deleteField() : obj[k];
  });
  // firebase v10 updateDoc 는 UpdateData 타입을 요구한다. 런타임 형태는 동일하므로
  // (값에 deleteField() 또는 원본 값) 안전하게 단언한다.
  return out as UpdateData<DocumentData>;
}

// 빈 문자열 -> undefined (선택 입력 필드 정리용)
export function emptyToUndef(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

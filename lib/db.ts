// Firestore CRUD 계층 — 모든 함수 async.
// 규칙: isFirebaseConfigured() 가 false 이면 throw 하지 않고 빈 배열/null/void 로 안전 반환.
// 데이터 패칭은 호출 측(client component, useEffect)에서만 수행한다.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  type Firestore,
  type QueryConstraint,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import { getDb, getStorageInstance, isFirebaseConfigured } from "./firebase";
import type {
  Store,
  WorkShift,
  Task,
  TaskBlock,
  TaskCheck,
  CalendarEvent,
  Product,
  Promotion,
  FragranceReplacement,
  CleaningGuide,
  CleaningZone,
} from "./types";
import {
  defaultProducts,
  defaultPromotions,
  defaultEvents,
  defaultFragrance,
  defaultCleaning,
} from "./defaults";

// 컬렉션 이름 상수
const COL = {
  shifts: "shifts",
  tasks: "tasks",
  taskBlocks: "taskBlocks", // 일일 업무 블록(라이브러리)
  taskChecks: "taskChecks",
  events: "events",
  products: "products",
  promotions: "promotions",
  settings: "settings", // 향료 교체일 / 청소 가이드 등 단건 설정
} as const;

// 설정 문서 id 생성 헬퍼
const fragranceDocId = (store: Store) => `fragrance_${store}`;
const cleaningDocId = (store: Store) => `cleaning_${store}`;

// db 인스턴스를 가져오되, 없으면 null (가드용)
function db(): Firestore | null {
  if (!isFirebaseConfigured()) return null;
  return getDb();
}

// 문서 스냅샷 -> { id, ...data } 변환
function docToData<T>(id: string, data: Record<string, unknown>): T {
  return { id, ...data } as T;
}

// ---------------------------------------------------------------------------
// WorkShift
// ---------------------------------------------------------------------------
export async function listShifts(opts?: {
  store?: Store;
  from?: string;
  to?: string;
}): Promise<WorkShift[]> {
  const d = db();
  if (!d) return [];
  const constraints: QueryConstraint[] = [];
  if (opts?.store) constraints.push(where("store", "==", opts.store));
  if (opts?.from) constraints.push(where("date", ">=", opts.from));
  if (opts?.to) constraints.push(where("date", "<=", opts.to));
  constraints.push(orderBy("date", "asc"));
  const snap = await getDocs(query(collection(d, COL.shifts), ...constraints));
  return snap.docs.map((s) => docToData<WorkShift>(s.id, s.data()));
}

export async function createShift(data: Omit<WorkShift, "id">): Promise<string> {
  const d = db();
  if (!d) return "";
  const refDoc = await addDoc(collection(d, COL.shifts), data);
  return refDoc.id;
}

// 낙관적 생성: 클라이언트에서 문서 id를 즉시 만들고 저장은 백그라운드로 진행.
// 저장 완료를 기다리지 않으므로 DB 미생성/오프라인이어도 UI가 멈추지 않는다
// (저장은 온라인/DB 복구 시 Firestore가 자동 동기화). 반환: 즉시 쓸 수 있는 id.
export function createShiftId(data: Omit<WorkShift, "id">): string {
  const d = db();
  if (!d) return "";
  const refDoc = doc(collection(d, COL.shifts));
  void setDoc(refDoc, data).catch(() => {});
  return refDoc.id;
}

export async function updateShift(
  id: string,
  data: Partial<WorkShift>
): Promise<void> {
  const d = db();
  if (!d) return;
  await updateDoc(doc(d, COL.shifts, id), data);
}

export async function deleteShift(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  await deleteDoc(doc(d, COL.shifts, id));
}

// ---------------------------------------------------------------------------
// 근무 일지(scheduler) schedules -> 대시보드용 WorkShift 어댑터
// 대시보드의 근무자 표시 소스를 "근무 일지" 탭의 근무 스케줄(schedules 컬렉션)로 통일.
// schedules(store=accent-id|accent-wow, employeeId, startTime/endTime)를
// 대시보드가 쓰는 WorkShift(store=id|wow, staffName, start/end, shiftType)로 변환한다.
// employeeId는 employees 컬렉션의 name 으로 해석.
// ---------------------------------------------------------------------------
const SCHEDULER_STORE_TO_LOCAL: Record<string, Store> = {
  "accent-id": "id",
  "accent-wow": "wow",
};

export async function listScheduleShifts(opts?: {
  store?: Store;
  from?: string;
  to?: string;
}): Promise<WorkShift[]> {
  const d = db();
  if (!d) return [];
  // 1) 직원 id -> 이름 맵
  const empSnap = await getDocs(collection(d, "employees"));
  const nameById = new Map<string, string>();
  empSnap.docs.forEach((s) => {
    const name = (s.data() as { name?: string }).name;
    if (name) nameById.set(s.id, name);
  });
  // 2) schedules 기간 조회 (date 단일 필드 범위 → 복합 인덱스 불필요)
  const constraints: QueryConstraint[] = [];
  if (opts?.from) constraints.push(where("date", ">=", opts.from));
  if (opts?.to) constraints.push(where("date", "<=", opts.to));
  const snap = await getDocs(query(collection(d, "schedules"), ...constraints));
  const rows: WorkShift[] = [];
  snap.docs.forEach((s) => {
    const x = s.data() as {
      employeeId?: string;
      date?: string;
      startTime?: string;
      endTime?: string;
      store?: string;
    };
    const store = x.store ? SCHEDULER_STORE_TO_LOCAL[x.store] : undefined;
    if (!store || !x.date) return;
    if (opts?.store && store !== opts.store) return; // 매장 필터(클라이언트)
    // 기본 종료시각보다 늦으면 '확장' 근무로 표시(원본 shiftType 부재 보완)
    const basicEnd = store === "id" ? "19:30" : "19:00";
    const end = x.endTime || "";
    rows.push({
      id: s.id,
      store,
      staffName: (x.employeeId && nameById.get(x.employeeId)) || "(직원)",
      date: x.date,
      start: x.startTime || "",
      end,
      shiftType: end > basicEnd ? "extended" : "basic",
    });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------
export async function listTasks(store?: Store): Promise<Task[]> {
  const d = db();
  if (!d) return [];
  const constraints: QueryConstraint[] = [];
  if (store) constraints.push(where("store", "==", store));
  const snap = await getDocs(query(collection(d, COL.tasks), ...constraints));
  const rows = snap.docs.map((s) => docToData<Task>(s.id, s.data()));
  // createdAt 정렬은 클라이언트에서 (where(store)+orderBy 복합 인덱스 회피 — 매장 필터 시 throw 방지)
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function createTask(
  data: Omit<Task, "id" | "createdAt">
): Promise<string> {
  const d = db();
  if (!d) return "";
  const payload = { ...data, createdAt: Date.now() };
  const refDoc = await addDoc(collection(d, COL.tasks), payload);
  return refDoc.id;
}

// 낙관적 생성: 문서 id를 즉시 만들고 저장은 백그라운드로(주간 스케줄 그리드용).
// 저장 완료를 기다리지 않으므로 버튼이 즉시 반응한다.
export function createTaskId(data: Omit<Task, "id" | "createdAt">): string {
  const d = db();
  if (!d) return "";
  const refDoc = doc(collection(d, COL.tasks));
  void setDoc(refDoc, { ...data, createdAt: Date.now() }).catch(() => {});
  return refDoc.id;
}

export async function updateTask(id: string, data: Partial<Task>): Promise<void> {
  const d = db();
  if (!d) return;
  await updateDoc(doc(d, COL.tasks, id), data);
}

export async function deleteTask(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  await deleteDoc(doc(d, COL.tasks, id));
}

// ---------------------------------------------------------------------------
// TaskBlock (일일 업무 블록 라이브러리)
// ---------------------------------------------------------------------------
export async function listTaskBlocks(store?: Store): Promise<TaskBlock[]> {
  const d = db();
  if (!d) return [];
  const constraints: QueryConstraint[] = [];
  if (store) constraints.push(where("store", "==", store));
  const snap = await getDocs(query(collection(d, COL.taskBlocks), ...constraints));
  const rows = snap.docs.map((s) => docToData<TaskBlock>(s.id, s.data()));
  // createdAt 정렬은 클라이언트에서 (where+orderBy 복합 인덱스 회피)
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function createTaskBlock(
  data: Omit<TaskBlock, "id" | "createdAt">
): Promise<string> {
  const d = db();
  if (!d) return "";
  const refDoc = await addDoc(collection(d, COL.taskBlocks), {
    ...data,
    createdAt: Date.now(),
  });
  return refDoc.id;
}

export async function updateTaskBlock(
  id: string,
  data: Partial<TaskBlock>
): Promise<void> {
  const d = db();
  if (!d) return;
  await updateDoc(doc(d, COL.taskBlocks, id), data);
}

export async function deleteTaskBlock(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  await deleteDoc(doc(d, COL.taskBlocks, id));
}

// ---------------------------------------------------------------------------
// TaskCheck (id = taskId + "_" + date)
// ---------------------------------------------------------------------------
export async function getTaskChecks(date: string): Promise<TaskCheck[]> {
  const d = db();
  if (!d) return [];
  const snap = await getDocs(
    query(collection(d, COL.taskChecks), where("date", "==", date))
  );
  return snap.docs.map((s) => docToData<TaskCheck>(s.id, s.data()));
}

// 기간([from,to]) 내 모든 체크 상태 — 캘린더 미완료 마커용
export async function listTaskChecks(opts: {
  from: string;
  to: string;
}): Promise<TaskCheck[]> {
  const d = db();
  if (!d) return [];
  const snap = await getDocs(
    query(
      collection(d, COL.taskChecks),
      where("date", ">=", opts.from),
      where("date", "<=", opts.to)
    )
  );
  return snap.docs.map((s) => docToData<TaskCheck>(s.id, s.data()));
}

// 체크 상태/비고 부분 업데이트 (merge) — checked 또는 note 한쪽만 보내도 다른 값 유지
export async function setTaskCheck(
  taskId: string,
  date: string,
  patch: { checked?: boolean; note?: string }
): Promise<void> {
  const d = db();
  if (!d) return;
  const id = `${taskId}_${date}`;
  await setDoc(
    doc(d, COL.taskChecks, id),
    { id, taskId, date, ...patch, checkedAt: Date.now() },
    { merge: true }
  );
}

// ---------------------------------------------------------------------------
// CalendarEvent
// ---------------------------------------------------------------------------
export async function listEvents(opts?: {
  store?: Store;
  from?: string;
  to?: string;
}): Promise<CalendarEvent[]> {
  const d = db();
  if (!d) return [];
  const constraints: QueryConstraint[] = [];
  // store 지정 시: 그 매장 + 'all'(전 매장 공통) 이벤트를 함께 조회한다.
  // Firestore 'in' 연산자로 단일 쿼리에서 OR(store == X || store == 'all') 처리.
  // (값 2개라 in 제한 10개 이내, 별도 복합 인덱스 불필요)
  if (opts?.store) constraints.push(where("store", "in", [opts.store, "all"]));
  const snap = await getDocs(query(collection(d, COL.events), ...constraints));
  let rows = snap.docs.map((s) => docToData<CalendarEvent>(s.id, s.data()));
  // 기간 필터(겹침 판정)는 클라이언트 측에서 수행해 인덱스 의존을 줄인다.
  if (opts?.from) rows = rows.filter((e) => e.endDate >= opts.from!);
  if (opts?.to) rows = rows.filter((e) => e.startDate <= opts.to!);
  rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return rows;
}

export async function createEvent(
  data: Omit<CalendarEvent, "id">
): Promise<string> {
  const d = db();
  if (!d) return "";
  const refDoc = await addDoc(collection(d, COL.events), data);
  return refDoc.id;
}

export async function updateEvent(
  id: string,
  data: Partial<CalendarEvent>
): Promise<void> {
  const d = db();
  if (!d) return;
  await updateDoc(doc(d, COL.events, id), data);
}

export async function deleteEvent(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  await deleteDoc(doc(d, COL.events, id));
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------
export async function listProducts(store?: Store): Promise<Product[]> {
  const d = db();
  if (!d) return [];
  const constraints: QueryConstraint[] = [];
  if (store) constraints.push(where("store", "==", store));
  const snap = await getDocs(query(collection(d, COL.products), ...constraints));
  const rows = snap.docs.map((s) => docToData<Product>(s.id, s.data()));
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

export async function createProduct(data: Omit<Product, "id">): Promise<string> {
  const d = db();
  if (!d) return "";
  const refDoc = await addDoc(collection(d, COL.products), data);
  return refDoc.id;
}

export async function updateProduct(
  id: string,
  data: Partial<Product>
): Promise<void> {
  const d = db();
  if (!d) return;
  await updateDoc(doc(d, COL.products, id), data);
}

export async function deleteProduct(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  await deleteDoc(doc(d, COL.products, id));
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------
export async function listPromotions(store?: Store): Promise<Promotion[]> {
  const d = db();
  if (!d) return [];
  const constraints: QueryConstraint[] = [];
  if (store) constraints.push(where("store", "==", store));
  const snap = await getDocs(
    query(collection(d, COL.promotions), ...constraints)
  );
  const rows = snap.docs.map((s) => docToData<Promotion>(s.id, s.data()));
  rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return rows;
}

export async function createPromotion(
  data: Omit<Promotion, "id">
): Promise<string> {
  const d = db();
  if (!d) return "";
  const refDoc = await addDoc(collection(d, COL.promotions), data);
  return refDoc.id;
}

export async function updatePromotion(
  id: string,
  data: Partial<Promotion>
): Promise<void> {
  const d = db();
  if (!d) return;
  await updateDoc(doc(d, COL.promotions, id), data);
}

export async function deletePromotion(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  await deleteDoc(doc(d, COL.promotions, id));
}

// ---------------------------------------------------------------------------
// Fragrance (settings 컬렉션 단건)
// ---------------------------------------------------------------------------
export async function getFragrance(
  store: Store
): Promise<FragranceReplacement | null> {
  const d = db();
  if (!d) return null;
  const snap = await getDoc(doc(d, COL.settings, fragranceDocId(store)));
  if (!snap.exists()) return null;
  return snap.data() as FragranceReplacement;
}

export async function setFragrance(
  store: Store,
  recentDate: string,
  nextDate: string
): Promise<void> {
  const d = db();
  if (!d) return;
  const payload: FragranceReplacement = { store, recentDate, nextDate };
  await setDoc(doc(d, COL.settings, fragranceDocId(store)), payload);
}

// ---------------------------------------------------------------------------
// Cleaning guide (settings 컬렉션 단건)
// ---------------------------------------------------------------------------
export async function getCleaning(store: Store): Promise<CleaningGuide | null> {
  const d = db();
  if (!d) return null;
  const snap = await getDoc(doc(d, COL.settings, cleaningDocId(store)));
  if (!snap.exists()) return null;
  return snap.data() as CleaningGuide;
}

export async function setCleaning(
  store: Store,
  zones: CleaningZone[]
): Promise<void> {
  const d = db();
  if (!d) return;
  const payload: CleaningGuide = { store, zones };
  await setDoc(doc(d, COL.settings, cleaningDocId(store)), payload);
}

// ---------------------------------------------------------------------------
// 이미지 업로드 (Firebase Storage) -> download URL 반환
// ---------------------------------------------------------------------------
export async function uploadImage(
  file: File,
  pathPrefix: string
): Promise<string> {
  if (!isFirebaseConfigured()) return "";
  const storage = getStorageInstance();
  if (!storage) return "";
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${pathPrefix}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

// ---------------------------------------------------------------------------
// 초기 데이터 시드 — 기본 상품/프로모션/이벤트/향료/청소 가이드를 1회 주입.
// 결정적 id 로 setDoc(merge:false) 하여 재호출 시 덮어쓰기(중복 누적 방지).
// ---------------------------------------------------------------------------
export async function seedInitialData(): Promise<void> {
  const d = db();
  if (!d) return;

  await Promise.all([
    ...defaultProducts.map(({ id, ...rest }) =>
      setDoc(doc(d, COL.products, id), { id, ...rest })
    ),
    ...defaultPromotions.map(({ id, ...rest }) =>
      setDoc(doc(d, COL.promotions, id), { id, ...rest })
    ),
    ...defaultEvents.map(({ id, ...rest }) =>
      setDoc(doc(d, COL.events, id), { id, ...rest })
    ),
    setDoc(doc(d, COL.settings, fragranceDocId(defaultFragrance.store)), {
      store: defaultFragrance.store,
      recentDate: defaultFragrance.recentDate,
      nextDate: defaultFragrance.nextDate,
    }),
    ...defaultCleaning.map((c) =>
      setDoc(doc(d, COL.settings, cleaningDocId(c.store)), c)
    ),
  ]);
}

// firebase 모듈의 가드 함수를 db 모듈에서도 재노출 (계약 요구)
export { isFirebaseConfigured } from "./firebase";

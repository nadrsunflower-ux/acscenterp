// ============================================================
//  공급자와 인감 — 견적서를 내는 쪽
// ------------------------------------------------------------
//  우리는 사업자가 둘이다. 화장품을 만들어 파는 **(주)네안데르**, 온라인
//  으로 파는 **와작홈즈**. 견적서가 어느 이름으로 나가느냐에 따라 공급자
//  표 여덟 칸이 통째로 달라지고, 찍히는 도장도 달라진다 — 네안데르는
//  대표이사 유재영, 와작홈즈는 대표 유선화다.
//
//  그래서 둘을 **프리셋** 으로 묶었다. 고르면 여덟 칸과 도장이 한 번에
//  채워지고, 그다음부터는 어느 칸이든 손으로 고칠 수 있다 — 프리셋은
//  묶어 두는 사슬이 아니라 출발점이다. 손으로 고친 견적서는 사업자번호로
//  다시 알아본다(matchPresetId). 어느 쪽과도 맞지 않으면 「직접 입력」.
//
//  도장은 등록된 것 중에서 고른다. 자유 업로드가 아니다 — 인감은 아무
//  이미지나 되면 안 되고, 어떤 도장이 어느 문서에 찍혔는지 나중에 물어볼
//  수 있어야 한다. 파일은 public/images/seals 에 두고 여기에는 id·이름만
//  적는다. 견적서 문서에는 그 id 한 줄만 남는다.
//
//  네안데르 법인인감은 대표자마다 하나씩 있다 — 유재영(윗점 ●), 이동주
//  (윗별 ★). 겉보기에 점 하나 차이지만 **다른 사람의 인감** 이다. 그래서
//  모르는 id 를 만나면 아무거나 찍지 않는다 (resolveSeal 참고).
//
//  도장은 곧 **사람** 이다. 그래서 도장을 고르면 공급자 표의 대표자·담당자·
//  연락처 세 칸이 그 사람으로 함께 바뀐다(sealOwnerFields). 세 칸이 따로
//  놀면 「담당자 유선화 / 연락처 유재영 번호」 같은 줄이 나가고, 받는 쪽은
//  누구에게 전화해야 할지 모른다. 프리셋의 공급자 칸도 같은 함수로 짓는다 —
//  사업자 정보(사업자번호·상호·소재지·업태·종목)만 손으로 적고, 사람 쪽
//  세 칸은 도장에서 끌어온다. 한 곳만 고쳐지는 날이 없도록.
// ============================================================

/** 견적서 공급자 칸 — 시트 오른쪽 위의 표 */
export interface FinSupplier {
  bizNo: string;
  name: string;
  ceo: string;
  address: string;
  bizType: string;
  bizItem: string;
  contact: string;
  phone: string;
}

// ---- 인감 --------------------------------------------------------

export interface FinSeal {
  id: string;
  /** 고르는 자리에 보이는 이름 */
  label: string;
  /** 도장 주인 — 이 도장을 찍으면 공급자 표의 대표자·담당자가 이 사람이 된다 */
  owner: string;
  /** 주인의 연락처 — 견적서를 받은 쪽이 눌러야 할 번호 */
  ownerPhone: string;
  /** public/ 아래 경로 */
  src: string;
}

/** 「인감 없음」 을 뜻하는 id. undefined 와 다르다 — 일부러 빼는 것이다 */
export const NO_SEAL = "none";

export const SEALS: FinSeal[] = [
  {
    id: "yoo-jaeyoung",
    label: "(주)네안데르 · 대표이사 유재영",
    owner: "유재영",
    ownerPhone: "010-8507-5121",
    src: "/images/seals/yoo-jaeyoung.png",
  },
  {
    id: "lee-dongju",
    label: "(주)네안데르 · 대표이사 이동주",
    owner: "이동주",
    ownerPhone: "010-2524-8421",
    src: "/images/seals/lee-dongju.png",
  },
  {
    id: "wajakhomes",
    label: "와작홈즈 · 유선화",
    owner: "유선화",
    ownerPhone: "010-8028-3822",
    src: "/images/seals/wajakhomes.png",
  },
];

export const DEFAULT_SEAL_ID = SEALS[0].id;

/**
 * 예전 id 를 지금 id 로. 이동주 인감을 한때 「유재영 도장의 별표 변형」 으로
 * 잘못 등록해 둔 적이 있다 — 그때 저장된 견적서가 사람을 바꿔 달지 않도록
 * 제 주인에게 돌려보낸다.
 */
const LEGACY_SEAL_IDS: Record<string, string> = {
  "yoo-jaeyoung-star": "lee-dongju",
};

/** 저장에 허용되는 값 — 등록된 인감 + 「없음」 */
export const SEAL_IDS = [...SEALS.map((s) => s.id), NO_SEAL] as const;

/** 저장 직전에 부르는 자리 — 예전 id 를 지금 id 로 바꿔 준다 */
export const canonicalSealId = (raw: unknown): string | undefined => {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return undefined;
  return LEGACY_SEAL_IDS[v] ?? v;
};

/**
 * 견적서에 실제로 찍힐 인감. 「없음」 이면 null.
 *
 * ⚠️ 모르는 id 는 **기본 인감으로 떨어지지 않는다.** 네안데르 법인인감은
 *    대표자마다 따로라, 지워진 도장을 아무거나로 메우면 남의 인감이 찍힌
 *    견적서가 나간다. 도장이 빠진 종이는 눈에 띄어 다시 찍을 수 있지만,
 *    엉뚱한 사람 도장이 찍힌 종이는 그대로 나간다.
 *
 * 값이 아예 없는 견적서(인감이 생기기 전에 만든 것)만 기본 인감으로 본다.
 */
export function resolveSeal(sealId?: string): FinSeal | null {
  if (sealId === NO_SEAL) return null;
  if (!sealId) return SEALS[0];
  const id = canonicalSealId(sealId);
  return SEALS.find((s) => s.id === id) ?? null;
}

// ---- 공급자 프리셋 ------------------------------------------------

/**
 * 도장 주인이 채우는 세 칸. 도장을 고를 때와 프리셋을 지을 때가 같은 값을 쓴다.
 * 모르는 도장(「찍지 않음」 포함)이면 null — 이름을 함부로 지우지 않는다.
 */
export function sealOwnerFields(sealId?: string): Pick<FinSupplier, "ceo" | "contact" | "phone"> | null {
  const seal = resolveSeal(sealId);
  return seal ? { ceo: seal.owner, contact: seal.owner, phone: seal.ownerPhone } : null;
}

export interface FinSupplierPreset {
  id: string;
  /** 고르는 자리에 보이는 이름 */
  label: string;
  supplier: FinSupplier;
  /** 이 사업자로 낼 때 기본으로 찍는 도장 */
  sealId: string;
}

/** 프리셋 어느 쪽과도 맞지 않는 견적서 — 여덟 칸을 손으로 채운 것 */
export const CUSTOM_PRESET = "custom";

/** 사업자등록증에 적힌 것 — 사람이 바뀌어도 그대로인 칸 */
type SupplierIdentity = Omit<FinSupplier, "ceo" | "contact" | "phone">;

const PRESET_DEFS: { id: string; label: string; sealId: string; identity: SupplierIdentity }[] = [
  {
    id: "neander",
    label: "(주)네안데르",
    sealId: "yoo-jaeyoung",
    identity: {
      bizNo: "683-86-02812",
      name: "(주)네안데르",
      address: "서울시 마포구 독막로36길 10-6, 1층",
      bizType: "도매 및 소매업",
      bizItem: "화장품 도소매업",
    },
  },
  {
    id: "wajakhomes",
    label: "와작홈즈",
    sealId: "wajakhomes",
    identity: {
      bizNo: "326-10-03024",
      name: "와작홈즈",
      address: "서울시 마포구 신수동 250-23 203호",
      bizType: "소매업",
      bizItem: "전자상거래 소매업",
    },
  },
];

export const SUPPLIER_PRESETS: FinSupplierPreset[] = PRESET_DEFS.map((d) => ({
  id: d.id,
  label: d.label,
  sealId: d.sealId,
  supplier: { ...d.identity, ...sealOwnerFields(d.sealId)! },
}));

export const DEFAULT_PRESET = SUPPLIER_PRESETS[0];

/** 새 견적서가 아무 실마리 없이 시작할 때의 공급자 칸 */
export const DEFAULT_SUPPLIER: FinSupplier = DEFAULT_PRESET.supplier;

/** 사업자번호(숫자만)로 견줘 본다 — 하이픈을 뺐거나 담당자만 바꾼 견적서도 알아본다 */
const digits = (s: string) => String(s ?? "").replace(/\D/g, "");

/** 이 공급자 칸이 어느 프리셋인지. 어느 쪽도 아니면 「직접 입력」 */
export function matchPresetId(supplier: FinSupplier): string {
  const no = digits(supplier.bizNo);
  if (!no) return CUSTOM_PRESET;
  return SUPPLIER_PRESETS.find((p) => digits(p.supplier.bizNo) === no)?.id ?? CUSTOM_PRESET;
}

export const findPreset = (id: string) => SUPPLIER_PRESETS.find((p) => p.id === id) ?? null;

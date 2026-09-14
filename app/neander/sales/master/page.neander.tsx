"use client";

// ============================================================
//  매출 › 마스터 — 적재와 기본가정
// ------------------------------------------------------------
//  최초 1회 「마스터 적재」로 엑셀에서 뽑아둔 기준 정보(상품·기본가정·
//  2026-07 이벤트)를 넣는다. 문서 id 가 상품코드라 여러 번 눌러도 중복되지
//  않고 덮어쓴다 (재무 마스터와 같은 방식). 이벤트는 방문자수·준비물을
//  사람이 고치는 값이라 이미 있으면 건드리지 않는다.
//
//  ⚠️ **상품은 여기서 고치지 않는다.** 「상품 관리」(/sales/catalog)로 나갔다.
//     적재 버튼과 기본가정은 한 해에 몇 번 손대는 값인데, 상품은 매달 손대는
//     값이라 한 화면에 두면 서로를 가린다.
//
//  ⚠️ 배치를 **설정 목록 + 설정 판**으로 바꿨다 (승인 목업 all-pages/
//     sales-master.png). 예전에는 Card 6장이 세로로 3,000px 넘게 늘어서서
//     수수료율 하나를 고치려고 배송비 문단을 지나가야 했고, 저장 버튼은 맨
//     아래에만 있어 무엇을 고쳤는지 잊은 채 눌렀다.
//
//     **미저장 표시가 없던 것이 제일 위험했다** — 고치다 말고 나가도 아무도
//     말리지 않았다. 지금은 제목 줄에 경고 점이 뜨고 「변경 취소」로 되돌린다.
//     폼 필드·검증·저장 함수는 예전 그대로다. 배치만 나눴다.
// ============================================================

import { useState } from "react";
import Link from "next/link";
import {
  Boxes,
  Clock,
  CreditCard,
  Database,
  Info,
  Landmark,
  Share2,
  TriangleAlert,
  Truck,
  Users,
} from "lucide-react";
import {
  Badge,
  BasisLine,
  Button,
  Card,
  Disclosure,
  ErrorState,
  Field,
  Icon,
  InfoPopover,
  InlineNotice,
  Input,
  LoadingState,
  MasterDetail,
  PageHeader,
  PageShell,
  SectionHeader,
  Select,
  StatusDot,
  TableNote,
  cn,
  useMediaQuery,
  useToast,
  type LucideIcon,
} from "@/components/neander/ui";
import { useSales } from "@/components/neander/sales/SalesProvider";
import { saveSalesAssumptions, seedSalesMaster } from "@/lib/neander/sales/client";
import { SEED_EVENTS, SEED_PRODUCTS } from "@/lib/neander/sales/master-data";
import {
  SALES_STORES,
  fixedTotal,
  idRegularLabor,
  type SalesAssumptions,
} from "@/lib/neander/sales/types";

/** 키 순서에 흔들리지 않는 비교용 문자열 */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)),
        )
      : val,
  );

/** 왼쪽 목록의 한 줄 = 오른쪽 설정 판 하나 */
type SectionKey = "labor" | "fixed" | "alloc" | "wage" | "shipping" | "fee";

const SECTIONS: { key: SectionKey; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "labor", label: "인건비 처리", hint: "고정비냐 변동비냐", icon: Users },
  { key: "fixed", label: "공통 고정비", hint: "임차료 · 공과금", icon: Landmark },
  { key: "alloc", label: "고정비 배부", hint: "매장별 비율", icon: Share2 },
  { key: "wage", label: "시급 · 운영", hint: "시급 · 운영시간", icon: Clock },
  { key: "shipping", label: "온라인 배송비", hint: "건당 금액 · 받던 기간", icon: Truck },
  { key: "fee", label: "결제 수수료율", hint: "경로별 요율", icon: CreditCard },
];

export default function SalesMasterPage() {
  const { assumptions, loading } = useSales();
  if (loading) return <LoadingState label="마스터를 불러오는 중…" />;
  // 불러온 뒤에 붙인다 — 편집 사본(useState)이 로딩 중의 빈 기본가정으로 굳지 않게
  return <MasterScreen assumptions={assumptions} />;
}

function MasterScreen({ assumptions }: { assumptions: SalesAssumptions }) {
  const { products, assumptionsSeeded: seeded, masterEmpty, error, refresh } = useSales();
  const toast = useToast();
  const [seeding, setSeeding] = useState(false);
  const [a, setA] = useState<SalesAssumptions>(assumptions);
  const [saving, setSaving] = useState(false);

  // lg 미만에서는 MasterDetail 이 한 판씩 그린다 — 그때는 아무것도 안 고른
  // 상태(목록)에서 시작하고, 넓은 화면에서는 첫 설정을 펴 둔다
  const wide = useMediaQuery("(min-width: 1024px)", true);
  const [picked, setPicked] = useState<SectionKey | null>(null);
  const active: SectionKey | null = picked ?? (wide ? "labor" : null);

  const num = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;
  const rate = (v: string) => {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n / 100 : 0;
  };
  const allocSum = a.allocation.wow + a.allocation.id + a.allocation.online;

  /**
   * 저장하지 않은 변경 — 불러온 값과 글자 하나라도 다르면 참.
   *
   * 키 순서를 맞춰 놓고 비교한다. 서버에서 다시 읽어온 문서는 키 순서가
   * 코드 기본값과 다를 수 있어서, 그냥 JSON.stringify 로 대면 저장한 직후에도
   * 「저장하지 않은 변경사항이 있습니다」가 계속 떠 있게 된다.
   */
  const dirty = stable(a) !== stable(assumptions);

  async function save() {
    setSaving(true);
    try {
      await saveSalesAssumptions(a);
      toast.success("기본가정을 저장했습니다.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function seed() {
    setSeeding(true);
    try {
      const res = await seedSalesMaster();
      toast.success(
        `상품 ${res.result.products}종 · 이벤트 ${res.result.events}건 적재` +
          (res.result.eventsKept > 0 ? ` (기존 이벤트 ${res.result.eventsKept}건은 그대로)` : ""),
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "적재에 실패했습니다.");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <PageShell width="default">
      <PageHeader
        title="마스터"
        description="엑셀 기준 적재와 기본가정(고정비 · 시급 · 수수료율)."
        className="mb-3"
        meta={
          dirty ? (
            <StatusDot tone="warning" className="text-nd-body font-medium text-nd-warning-text">
              저장하지 않은 변경사항이 있습니다
            </StatusDot>
          ) : undefined
        }
        actions={
          <>
            <Link href="/neander/sales/catalog">
              <Button variant="ghost" icon={Boxes}>
                상품 관리
              </Button>
            </Link>
            <Button
              variant={masterEmpty ? "primary" : "secondary"}
              icon={Database}
              loading={seeding}
              onClick={() => void seed()}
            >
              {masterEmpty ? "마스터 적재하기" : "엑셀 기준으로 다시 적재"}
            </Button>
            <Button variant="ghost" disabled={!dirty || saving} onClick={() => setA(assumptions)}>
              변경 취소
            </Button>
            <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
              기본가정 저장
            </Button>
          </>
        }
      />

      {/* 기준 한 줄 — 예전에는 이 내용이 화면 위 InlineNotice 두 장이었다 */}
      <BasisLine
        className="mb-4"
        items={[
          `월 고정비 ${fixedTotal(a).toLocaleString("ko-KR")}원`,
          `아이디 상시 인건비 ${idRegularLabor(a).toLocaleString("ko-KR")}원`,
          `상품 ${products.length.toLocaleString("ko-KR")}종 적재됨`,
        ]}
      >
        <InfoPopover
          label="이 화면의 역할"
          title="마스터와 상품 관리는 다릅니다"
          terms={[
            {
              term: "마스터 적재",
              desc: (
                <>
                  엑셀에 적어둔 기준값을 한 번에 넣습니다 — 상품 {SEED_PRODUCTS.length}종, 기본가정,
                  이벤트 {SEED_EVENTS.length}건. 이미 있는 이벤트는 방문자·준비물을 사람이 고친
                  값이라 건드리지 않습니다.
                </>
              ),
            },
            {
              term: "다시 적재",
              desc: "엑셀 기준값으로 되돌립니다. 화면에서 고친 상품 값이 덮어써집니다.",
            },
            {
              term: "상품 고치기",
              desc: (
                <>
                  판매가 · 재료비 · 전용 이벤트 · 별칭은{" "}
                  <Link
                    href="/neander/sales/catalog"
                    className="font-medium text-nd-accent-strong hover:underline"
                  >
                    상품 관리
                  </Link>
                  에서 고칩니다. 여기는 한 해에 몇 번 손대는 값만 둡니다.
                </>
              ),
            },
            {
              term: "기본가정",
              desc: "여기서 고친 값은 월 손익 · 상품 수익성 · 검토 대기함의 모든 계산에 바로 들어갑니다.",
            },
          ]}
        />
      </BasisLine>

      {!!error && (
        <ErrorState
          className="mb-4"
          title="마스터를 불러올 수 없습니다"
          description={error instanceof Error ? error.message : "알 수 없는 오류"}
        />
      )}

      {/* 남긴 배너는 경고뿐 — 설명은 위 기준 줄과 각 설정 판 아래 hint 로 내렸다 */}
      {masterEmpty && !error && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          아직 마스터가 비어 있습니다. <b>마스터 적재하기</b>를 누르면 상품 {SEED_PRODUCTS.length}종,
          기본가정(고정비 {fixedTotal(a).toLocaleString("ko-KR")}원 · 시급{" "}
          {a.wage.eventStaff.toLocaleString("ko-KR")}원), 이벤트 {SEED_EVENTS.length}건이 들어갑니다.
        </InlineNotice>
      )}

      {!seeded && (
        <InlineNotice tone="warning" icon={TriangleAlert} className="mb-4">
          아직 저장된 기본가정이 없어 <b>코드 기본값</b>을 보여주고 있습니다. 저장을 누르면
          Firestore 에 기록됩니다.
        </InlineNotice>
      )}

      <MasterDetail
        className="mb-4"
        selected={!!active}
        onBack={() => setPicked(null)}
        backLabel="설정 목록으로"
        listWidth={240}
        list={
          <Card padding="none" className="overflow-hidden">
            <div className="px-4 pb-2 pt-4">
              <h2 className="text-nd-section text-nd-fg">매출 설정</h2>
            </div>
            <ul className="border-t border-nd-line">
              {SECTIONS.map((s) => {
                const on = active === s.key;
                // 배부 합이 100% 가 아닌 것은 다른 판을 보는 중에도 알아야 한다
                const warn = s.key === "alloc" && allocSum !== 1;
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => setPicked(s.key)}
                      aria-current={on ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 border-b border-nd-line px-4 py-2.5 text-left transition-colors duration-nd-fast last:border-b-0",
                        on ? "bg-nd-accent-soft" : "hover:bg-nd-sunken",
                      )}
                    >
                      <Icon icon={s.icon} size={16} className="shrink-0 text-nd-fg-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-nd-body font-medium text-nd-fg">
                          {s.label}
                        </span>
                        <span className="block truncate text-nd-micro text-nd-fg-3">{s.hint}</span>
                      </span>
                      {warn && (
                        <Badge tone="danger" size="sm">
                          합 {(allocSum * 100).toFixed(0)}%
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        }
        detail={
          <div className="min-w-0">
            {active === "labor" && (
              <Card>
                <SectionHeader title="인건비 처리" hint="엑셀이 같은 인건비를 두 번 세던 지점" />
                <InlineNotice tone="warning" icon={TriangleAlert} className="mb-3">
                  엑셀은 아이디 인건비를 <b>두 곳</b>에 넣습니다 — 상시상품 줄마다 「타임인건비」
                  {" "}(2026-07 1,295,000원)와 고정비의 「상시 인건비」(2,100,000원). 같은 사람의 같은
                  시간입니다. 13–20시 고정 근무라 손님이 오든 안 오든 지급되므로{" "}
                  <b>고정비가 맞습니다.</b>
                </InlineNotice>
                <Field label="상시 인건비를 어디에 넣을까" required>
                  <Select
                    size="sm"
                    value={a.laborMode}
                    onChange={(e) => setA({ ...a, laborMode: e.target.value as "fixed" | "excel" })}
                  >
                    <option value="fixed">고정비로만 (권장) — 접객 인건비는 가동률 참고값</option>
                    <option value="excel">엑셀 재현 — 타임인건비를 변동비에도 넣는다 (검증용)</option>
                  </Select>
                </Field>
                <TableNote className="pt-2">
                  「고정비로만」은 아이디 공헌이익이 엑셀보다 1,295,000원 높게 나옵니다 — 그게 맞는
                  숫자입니다.
                </TableNote>
                {/* 2026-09-15 — 인건비가 가정값에서 근무 일지 실측으로 옮겨 갔다 (lib/neander/sales/labor.ts) */}
                <InlineNotice tone="info" className="mt-3">
                  <p className="font-semibold">인건비는 이제 근무 일지 실측에서 옵니다</p>
                  <p className="mt-1 text-nd-caption leading-relaxed">
                    달이 끝났고 그 매장에 근무 기록이 있으면, AC&apos;SCENT 관리자 「근무 일지」의 저장된 급여
                    + 주휴수당(급여 보고서와 같은 규칙) + 정직원 근무시간 × 아래 가정 시급으로 계산합니다.
                    아이디 근무는 「상시 인건비」, 와우 근무는 그날 열린 이벤트의 인건비가 되고 가정값과{" "}
                    <b>더하지 않습니다</b>(같은 시간을 두 번 세지 않게 — 실측 달에는 엑셀 재현 모드의 접객
                    인건비도 넣지 않습니다). 진행 중인 달이나 기록이 없는 달만 아래 시급·운영시간 가정을 쓰고
                    손익표에 「추정」으로 표시합니다. 3.3% 원천징수는 직원 몫이라 비용에 더하지 않습니다.
                  </p>
                </InlineNotice>
              </Card>
            )}

            {active === "fixed" && (
              <Card>
                <SectionHeader
                  title="공통 고정비"
                  hint={`월 합계 ${fixedTotal(a).toLocaleString("ko-KR")}원`}
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="매장 임차료" hint="와우 + 아이디 공동">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.fixed.rent)}
                      onChange={(e) => setA({ ...a, fixed: { ...a.fixed, rent: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="전기·수도·가스">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.fixed.utility)}
                      onChange={(e) => setA({ ...a, fixed: { ...a.fixed, utility: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="인터넷·통신비">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.fixed.telecom)}
                      onChange={(e) => setA({ ...a, fixed: { ...a.fixed, telecom: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="보험료">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.fixed.insurance)}
                      onChange={(e) => setA({ ...a, fixed: { ...a.fixed, insurance: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="기타">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.fixed.etc)}
                      onChange={(e) => setA({ ...a, fixed: { ...a.fixed, etc: num(e.target.value) } })}
                    />
                  </Field>
                </div>
                <TableNote className="pt-2">
                  여기 합계를 아래 「고정비 배부」 비율로 매장에 나눕니다.
                </TableNote>
              </Card>
            )}

            {active === "alloc" && (
              <Card>
                <SectionHeader
                  title="고정비 배부"
                  hint="사실이 아니라 경영 판단입니다"
                  action={
                    allocSum !== 1 ? (
                      <Badge tone="danger" size="sm">
                        합이 {(allocSum * 100).toFixed(0)}% 입니다
                      </Badge>
                    ) : undefined
                  }
                />
                <div className="grid gap-4 sm:grid-cols-3">
                  {SALES_STORES.map((s) => (
                    <Field key={s.value} label={`${s.label} (%)`} hint={s.hint}>
                      <Input
                        size="sm"
                        inputMode="decimal"
                        className="nd-num"
                        value={String(Math.round((a.allocation[s.value] ?? 0) * 1000) / 10)}
                        onChange={(e) =>
                          setA({
                            ...a,
                            allocation: { ...a.allocation, [s.value]: rate(e.target.value) },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <TableNote className="pt-2">
                  50:50 말고 면적이나 운영일수가 더 맞을 수 있습니다 —{" "}
                  <Link href="/neander/sales" className="font-medium text-nd-accent-strong hover:underline">
                    바꿔서 월 손익을 확인
                  </Link>
                  해 보세요.
                </TableNote>
              </Card>
            )}

            {active === "wage" && (
              <Card>
                <SectionHeader
                  title="시급 · 운영"
                  hint={`아이디 월 상시 인건비 ${idRegularLabor(a).toLocaleString("ko-KR")}원`}
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="이벤트 스태프 시급">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.wage.eventStaff)}
                      onChange={(e) => setA({ ...a, wage: { ...a.wage, eventStaff: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="아이디 상시 시급">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.wage.idRegular)}
                      onChange={(e) => setA({ ...a, wage: { ...a.wage, idRegular: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="제작 시급" hint="3D프린팅 등">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.wage.puddi)}
                      onChange={(e) => setA({ ...a, wage: { ...a.wage, puddi: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="온라인 제작 시급">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.wage.online)}
                      onChange={(e) => setA({ ...a, wage: { ...a.wage, online: num(e.target.value) } })}
                    />
                  </Field>
                  <Field label="아이디 일 운영시간" hint="13–20시 = 7">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.idOps.hoursPerDay)}
                      onChange={(e) =>
                        setA({ ...a, idOps: { ...a.idOps, hoursPerDay: num(e.target.value) } })
                      }
                    />
                  </Field>
                  <Field label="아이디 월 운영일수">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.idOps.daysPerMonth)}
                      onChange={(e) =>
                        setA({ ...a, idOps: { ...a.idOps, daysPerMonth: num(e.target.value) } })
                      }
                    />
                  </Field>
                  <Field label="와우 이벤트 일 운영시간">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.wowOps.hoursPerDay)}
                      onChange={(e) => setA({ ...a, wowOps: { hoursPerDay: num(e.target.value) } })}
                    />
                  </Field>
                </div>
                <TableNote className="pt-2">
                  이벤트에서 시급을 비워 두면 여기 「이벤트 스태프 시급」을 씁니다.
                </TableNote>
              </Card>
            )}

            {active === "shipping" && (
              <Card>
                <SectionHeader title="온라인 배송비" hint="특정 시점까지 주문에 더해 받던 금액" />
                <InlineNotice tone="warning" icon={TriangleAlert} className="mb-3">
                  엑셀 기본가정은 「10ml 판매가 28,000 (배송비 포함)」 — 24,000 + <b>4,000</b> 을
                  뜻하는데, 실제 청구액은 <b>3,000원</b>이었습니다 (2026-03 시트의 「배송비」 열). 그
                  4,000 가정은 2~7월 내내 갱신되지 않은 채 남아 있습니다.
                </InlineNotice>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="건당 배송비(원)" hint="0 이면 배송비 없음">
                    <Input
                      size="sm"
                      inputMode="numeric"
                      className="nd-num"
                      value={String(a.shipping?.fee ?? 0)}
                      onChange={(e) =>
                        setA({
                          ...a,
                          shipping: {
                            ...(a.shipping ?? {}),
                            fee: num(e.target.value),
                            until: a.shipping?.until,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="받던 마지막 날짜" hint="이 날 이후는 무료 — 비우면 지금도 받는다">
                    <Input
                      size="sm"
                      type="date"
                      value={a.shipping?.until ?? ""}
                      onChange={(e) =>
                        setA({
                          ...a,
                          shipping: {
                            ...(a.shipping ?? { fee: 0 }),
                            fee: a.shipping?.fee ?? 0,
                            until: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
                <TableNote className="pt-2">
                  배송비는 <b>온라인 매장</b>에만 붙습니다. 자세한 해석 규칙은 아래 「고급 설정 및
                  도움말」에 있습니다.
                  {a.shipping?.note && (
                    <span className="mt-1 block text-nd-fg-3">실측: {a.shipping.note}</span>
                  )}
                </TableNote>
              </Card>
            )}

            {active === "fee" && (
              <Card>
                <SectionHeader title="결제 수수료율" hint="경로마다 하나씩만 걸립니다 (부가세 별도)" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(
                    [
                      ["naverBooking", "네이버 예약 Npay (%)", "중소1 2.35"],
                      ["naverInStore", "네이버 매장방문결제 (%)", "중소1 1.35"],
                      ["naverOverseas", "네이버 해외발급카드 (%)", "3.5"],
                      ["card", "신용카드 (%)", "실측 1.0"],
                      ["debit", "체크카드 (%)", "실측 0.75"],
                      ["easyCash", "현금성 간편결제 (%)", "계약 요율"],
                    ] as const
                  ).map(([key, label, ph]) => (
                    <Field key={key} label={label}>
                      <Input
                        size="sm"
                        inputMode="decimal"
                        className="nd-num"
                        placeholder={ph}
                        value={
                          a.fee[key] === undefined ? "" : String(Math.round(a.fee[key]! * 10000) / 100)
                        }
                        onChange={(e) =>
                          setA({
                            ...a,
                            fee: {
                              ...a.fee,
                              [key]: e.target.value.trim() === "" ? undefined : rate(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                <TableNote className="pt-2">
                  한 줄에 <b>하나만</b> 걸립니다. 우리 등급은 <b>중소1</b> — 카드사가 달라도 요율은
                  같습니다. 근거는 아래 「고급 설정 및 도움말」에 있습니다.
                </TableNote>
              </Card>
            )}
          </div>
        }
      />

      {/* 길지만 없으면 안 되는 근거 — 매번 읽을 것은 아니라 접어 둔다 */}
      <Disclosure
        icon={Info}
        title="고급 설정 및 도움말"
        description="배부 기준 · 배송비 해석 · 수수료 요율의 근거"
      >
        <dl className="flex flex-col gap-2.5 text-nd-caption leading-relaxed">
          <div className="grid gap-x-3 sm:grid-cols-[minmax(7rem,auto)_1fr]">
            <dt className="font-medium text-nd-fg">고정비 배부</dt>
            <dd className="text-nd-fg-2">
              와우는 이벤트 기간에만 열고 아이디는 매일 13–20시 엽니다. 50:50 은 엑셀이 쓰던 값일
              뿐이고, 면적이나 운영일수가 더 맞을 수 있습니다 — 바꾸면 매장별 영업이익이 바로
              달라집니다.
            </dd>
          </div>
          <div className="grid gap-x-3 sm:grid-cols-[minmax(7rem,auto)_1fr]">
            <dt className="font-medium text-nd-fg">배송비 해석</dt>
            <dd className="text-nd-fg-2">
              해석기가 이 금액을 알면 배송비 포함 결제(24,000 + 3,000 = 27,000)를 상품 1개로
              읽습니다. 복수 구매는 배송비가 0 이었어서, 배송비 없는 해석을 먼저 시도합니다.
              <br />
              ⚠️ 원가(5,116 등)에는 <b>이미 배송비가 들어 있습니다</b>(기본가정 「재료+배송」).
              배송비를 안 받게 되면서 수입만 줄고 비용은 그대로입니다 — 그게 이 변화의 손익
              효과입니다.
            </dd>
          </div>
          <div className="grid gap-x-3 sm:grid-cols-[minmax(7rem,auto)_1fr]">
            <dt className="font-medium text-nd-fg">수수료 요율</dt>
            <dd className="text-nd-fg-2">
              경로(네이버/현장/온라인)와 결제수단으로 하나만 고릅니다. 네이버 예약은 Npay
              수수료로 끝납니다: 네이버 공식 안내가 「따로 부과되는 카드사 수수료는 없습니다」라고
              밝히고 있어, 엑셀처럼 카드 수수료를 더하면 이중 계상입니다. 카드는{" "}
              <b>카드사별로 다르지 않습니다</b> — 영세·중소 우대수수료율은 여신전문금융업법이 정한
              법정 요율이라 신한·삼성·현대 어디서 긁어도 같습니다(카드사와 협상하는 건 연매출 30억
              초과 일반가맹점뿐). 실제로 여신금융협회 매입내역(2026-07 와우 145건)에서 카드사 5곳이
              모두 신용 <b>1.000%</b> · 체크 <b>0.750%</b> 였습니다. 비워 두면 신용카드 요율로
              물러섭니다. 등급은 반기마다(1월 말·7월 말) 재산정되니 통지서가 오면 고쳐 주세요.
            </dd>
          </div>
          <div className="grid gap-x-3 sm:grid-cols-[minmax(7rem,auto)_1fr]">
            <dt className="font-medium text-nd-fg">인건비 처리</dt>
            <dd className="text-nd-fg-2">
              엑셀과 원 단위로 맞춰 검증할 때만 「엑셀 재현」으로 바꾸세요. 평소에는 「고정비로만」이
              맞습니다.
            </dd>
          </div>
        </dl>
      </Disclosure>
    </PageShell>
  );
}

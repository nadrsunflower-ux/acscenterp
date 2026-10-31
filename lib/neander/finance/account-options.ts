import type { FinAccountDoc } from "./db-types";
import { isAllowedTxAccountMismatch } from "./classify";
import type { FinTransaction } from "./types";

type AccountSelection = Pick<FinTransaction, "txType" | "acctMajor" | "acctMid" | "acctMinor">;

/** 계정 선택기도 원장 검증과 같은 유형 예외를 허용한다. */
export function selectableAccounts(accounts: FinAccountDoc[], selection: AccountSelection): FinAccountDoc[] {
  return accounts.filter((account) => {
    // 카드대금결제는 지출 마스터의 카드대금결제 계정만, 환급은 원래 지출
    // 계정을 쓴다. 카드 결제에 일반 지출 계정을 모두 열지는 않는다.
    const compatible = account.txType === selection.txType ||
      (account.txType === "지출" && isAllowedTxAccountMismatch(selection.txType, account.minor, account.txType));
    const selected = account.major === selection.acctMajor && account.mid === selection.acctMid && account.minor === selection.acctMinor;
    return compatible && (account.active !== false || selected);
  });
}

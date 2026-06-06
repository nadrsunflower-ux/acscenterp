import type { ReactNode } from "react";

export interface SectionProps {
  title: string;
  // 제목 우측 보조 텍스트/뱃지 등
  subtitle?: ReactNode;
  // 제목 우측 정렬 액션 영역 (버튼 등)
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

// 제목 + children 을 감싸는 카드형 섹션
export default function Section({
  title,
  subtitle,
  action,
  children,
  className = "",
}: SectionProps) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          {subtitle ? (
            <div className="mt-0.5 text-sm text-gray-500">{subtitle}</div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

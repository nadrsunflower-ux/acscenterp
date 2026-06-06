import type { RefundMethod } from "@/lib/content";
import ImageBlock from "@/components/ui/ImageBlock";

export interface RefundMethodsProps {
  methods: RefundMethod[];
}

// 환불 방법별 단계 + (있으면) 안내 이미지 렌더.
export default function RefundMethods({ methods }: RefundMethodsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {methods.map((method) => (
        <div
          key={method.title}
          className="rounded-xl border border-gray-100 bg-gray-50 p-4"
        >
          <h4 className="mb-2 text-sm font-bold text-gray-900">
            {method.title}
          </h4>
          <ol className="space-y-1">
            {method.steps.map((step, i) => (
              <li
                key={step}
                className="flex items-start gap-2 text-sm text-gray-700"
              >
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-dark">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {method.images && method.images.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {method.images.map((src, i) => (
                <ImageBlock
                  key={src}
                  src={src}
                  alt={`${method.title} 안내 ${i + 1}`}
                  aspectClassName="aspect-[3/4]"
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

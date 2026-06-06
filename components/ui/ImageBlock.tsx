import Image from "next/image";

export interface ImageBlockProps {
  src: string;
  label?: string;
  alt?: string;
  // 컨테이너 추가 클래스
  className?: string;
  // 이미지 비율 (기본 4/3). Tailwind aspect 클래스 그대로 전달.
  aspectClassName?: string;
}

// 라벨 + next/image 표시 블록. next.config 의 images.unoptimized 와 함께 동작.
export default function ImageBlock({
  src,
  label,
  alt,
  className = "",
  aspectClassName = "aspect-[4/3]",
}: ImageBlockProps) {
  return (
    <figure className={`overflow-hidden rounded-xl ring-1 ring-black/5 ${className}`}>
      <div className={`relative w-full bg-gray-100 ${aspectClassName}`}>
        <Image
          src={src}
          alt={alt ?? label ?? "이미지"}
          fill
          sizes="(max-width: 640px) 100vw, 33vw"
          className="object-cover"
        />
      </div>
      {label ? (
        <figcaption className="bg-white px-3 py-2 text-center text-sm font-medium text-gray-700">
          {label}
        </figcaption>
      ) : null}
    </figure>
  );
}

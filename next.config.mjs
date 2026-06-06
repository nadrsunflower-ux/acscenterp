/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // 로컬/정적 이미지를 그대로 사용 (외부 도메인 설정 불필요)
    unoptimized: true,
  },
};

export default nextConfig;

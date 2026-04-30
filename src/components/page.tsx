import dynamic from "next/dynamic";

// ssr: false → SSR 완전히 끔
// isClient 가드 없이도 hydration 루프 발생 안 함
const MomAssetMaster = dynamic(
  () => import("@/components/MomAssetMaster"),
  { ssr: false }
);

export default function Page() {
  return <MomAssetMaster />;
}

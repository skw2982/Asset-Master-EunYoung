import dynamic from "next/dynamic";

const MomAssetMaster = dynamic(
  () => import("@/components/MomAssetMaster"),
  { ssr: false }
);

export default function Page() {
  return <MomAssetMaster />;
}

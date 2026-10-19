import DatabaseSetup from "@/components/DatabaseSetup";
import DatabaseTransfer from "@/components/DatabaseTransfer";

export const dynamic = "force-dynamic";

export default function DatabasePage() {
  return (
    <>
      <DatabaseSetup />
      <DatabaseTransfer />
    </>
  );
}

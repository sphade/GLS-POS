import { useRouter } from "expo-router";
import { SimpleScreen } from "@/components/SimpleScreen";
import { formatMoney } from "@/constants/theme";
import { mockItems } from "@/lib/mock-items";

export default function InventoryScreen() {
  const router = useRouter();
  const rows = mockItems.map((i) => ({
    label: i.name,
    value: `${formatMoney(i.price, i.currency)}${i.stockQuantity !== null ? ` · ${i.stockQuantity}` : ""}`,
    icon: "package-variant-closed" as const,
  }));
  return (
    <SimpleScreen
      title="Items and SubItems"
      rows={rows}
      fabLabel="New Item"
      onFab={() => router.push("/item-editor")}
    />
  );
}
